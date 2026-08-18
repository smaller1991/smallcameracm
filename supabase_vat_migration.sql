-- SMALL CAMERA — VAT management migration
-- Run once in Supabase SQL Editor before deploying the VAT-enabled app.

CREATE TABLE IF NOT EXISTS public.vat_settings (
  id                    TEXT PRIMARY KEY DEFAULT 'main',
  enabled               BOOLEAN NOT NULL DEFAULT true,
  vat_rate              NUMERIC(5,2) NOT NULL DEFAULT 7,
  prices_include_vat    BOOLEAN NOT NULL DEFAULT true,
  business_name         TEXT NOT NULL DEFAULT 'SMALL CAMERA',
  seller_name           TEXT,
  business_tax_id       TEXT,
  business_address      TEXT,
  business_branch       TEXT NOT NULL DEFAULT 'สำนักงานใหญ่',
  business_phone        TEXT,
  invoice_prefix        TEXT NOT NULL DEFAULT 'TAX',
  sequence_reset        TEXT NOT NULL DEFAULT 'yearly' CHECK (sequence_reset IN ('yearly','monthly','never')),
  last_sequence_key     TEXT,
  last_invoice_number   BIGINT NOT NULL DEFAULT 0,
  next_full_number      BIGINT NOT NULL DEFAULT 1 CHECK (next_full_number >= 1),
  abbreviated_enabled   BOOLEAN NOT NULL DEFAULT true,
  abbreviated_invoice_prefix TEXT NOT NULL DEFAULT 'SM',
  abbreviated_sequence_reset TEXT NOT NULL DEFAULT 'monthly' CHECK (abbreviated_sequence_reset IN ('yearly','monthly','never')),
  abbreviated_last_sequence_key TEXT,
  abbreviated_last_invoice_number BIGINT NOT NULL DEFAULT 0,
  next_abbreviated_number BIGINT NOT NULL DEFAULT 1 CHECK (next_abbreviated_number >= 1),
  default_document_type TEXT NOT NULL DEFAULT 'abbreviated' CHECK (default_document_type IN ('full','abbreviated')),
  abbreviated_footer_note TEXT,
  footer_note           TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.vat_settings (id)
VALUES ('main')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.vat_documents (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_key               TEXT NOT NULL UNIQUE,
  source_type              TEXT NOT NULL DEFAULT 'sale' CHECK (source_type IN ('sale','bulk_sale','installment','trade')),
  source_transaction_ids   UUID[] NOT NULL DEFAULT '{}',
  source_sale_batch_id     UUID,
  status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void')),
  document_type            TEXT NOT NULL DEFAULT 'abbreviated' CHECK (document_type IN ('full','abbreviated')),
  document_number          TEXT UNIQUE,
  document_date            TIMESTAMPTZ NOT NULL,
  customer_name            TEXT,
  customer_tax_id          TEXT,
  customer_address         TEXT,
  customer_branch          TEXT,
  customer_phone           TEXT,
  items                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate                 NUMERIC(5,2) NOT NULL DEFAULT 7,
  vat_amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method           TEXT,
  note                     TEXT,
  business_snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  replaces_document_id     UUID,
  replaced_by_document_id  UUID,
  replacement_of_number    TEXT,
  issued_at                TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,
  void_reason              TEXT,
  printed_count            INTEGER NOT NULL DEFAULT 0,
  last_printed_at          TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vat_document_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id   UUID NOT NULL REFERENCES public.vat_documents(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vat_number_sequences (
  document_type TEXT NOT NULL CHECK (document_type IN ('full','abbreviated')),
  sequence_key  TEXT NOT NULL,
  last_number   BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (document_type, sequence_key)
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS vat_document_id UUID;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_vat_document_id_fkey;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_vat_document_id_fkey
  FOREIGN KEY (vat_document_id) REFERENCES public.vat_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vat_documents_date ON public.vat_documents(document_date DESC);
CREATE INDEX IF NOT EXISTS idx_vat_documents_status ON public.vat_documents(status);
CREATE INDEX IF NOT EXISTS idx_transactions_vat_document_id ON public.transactions(vat_document_id);

ALTER TABLE public.vat_documents
  DROP CONSTRAINT IF EXISTS vat_documents_replaces_document_id_fkey;
ALTER TABLE public.vat_documents
  ADD CONSTRAINT vat_documents_replaces_document_id_fkey
  FOREIGN KEY (replaces_document_id) REFERENCES public.vat_documents(id) ON DELETE SET NULL;
ALTER TABLE public.vat_documents
  DROP CONSTRAINT IF EXISTS vat_documents_replaced_by_document_id_fkey;
ALTER TABLE public.vat_documents
  ADD CONSTRAINT vat_documents_replaced_by_document_id_fkey
  FOREIGN KEY (replaced_by_document_id) REFERENCES public.vat_documents(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS trg_vat_settings_updated_at ON public.vat_settings;
CREATE TRIGGER trg_vat_settings_updated_at
  BEFORE UPDATE ON public.vat_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_vat_documents_updated_at ON public.vat_documents;
CREATE TRIGGER trg_vat_documents_updated_at
  BEFORE UPDATE ON public.vat_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.vat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_number_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_vat_settings ON public.vat_settings;
CREATE POLICY auth_vat_settings ON public.vat_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_vat_documents ON public.vat_documents;
CREATE POLICY auth_vat_documents ON public.vat_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_vat_document_events ON public.vat_document_events;
CREATE POLICY auth_vat_document_events ON public.vat_document_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_vat_number_sequences ON public.vat_number_sequences;
CREATE POLICY auth_vat_number_sequences ON public.vat_number_sequences
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.issue_vat_document(p_document_id UUID, p_document_type TEXT DEFAULT NULL)
RETURNS public.vat_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_doc public.vat_documents;
  v_settings public.vat_settings;
  v_key TEXT;
  v_next BIGINT;
  v_number TEXT;
  v_type TEXT;
  v_prefix TEXT;
  v_reset TEXT;
  v_manual_number BOOLEAN;
BEGIN
  SELECT * INTO v_doc
  FROM public.vat_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VAT document not found';
  END IF;

  IF v_doc.status = 'issued' THEN
    RETURN v_doc;
  END IF;

  IF v_doc.status = 'void' THEN
    RAISE EXCEPTION 'Voided VAT document cannot be issued';
  END IF;

  SELECT * INTO v_settings
  FROM public.vat_settings
  WHERE id = 'main'
  FOR UPDATE;

  v_type := COALESCE(p_document_type, v_doc.document_type, v_settings.default_document_type, 'abbreviated');
  IF v_type NOT IN ('full', 'abbreviated') THEN
    RAISE EXCEPTION 'Invalid VAT document type';
  END IF;
  IF v_type = 'abbreviated' AND NOT v_settings.abbreviated_enabled THEN
    RAISE EXCEPTION 'Abbreviated VAT invoices are disabled';
  END IF;
  v_prefix := CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_invoice_prefix ELSE v_settings.invoice_prefix END;
  v_reset := CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_sequence_reset ELSE v_settings.sequence_reset END;
  v_key := CASE v_reset
    WHEN 'monthly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
    WHEN 'yearly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
    ELSE 'all'
  END;

  v_number := NULLIF(BTRIM(v_doc.document_number), '');
  v_manual_number := v_number IS NOT NULL;
  IF NOT v_manual_number THEN
    v_next := CASE WHEN v_type = 'abbreviated' THEN v_settings.next_abbreviated_number ELSE v_settings.next_full_number END;
    v_next := GREATEST(COALESCE(v_next, 1), 1);
    v_number := v_prefix || '-' ||
      CASE WHEN v_reset = 'monthly'
        THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
        ELSE TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
      END || '-' || LPAD(v_next::TEXT, 6, '0');
  END IF;

  UPDATE public.vat_settings
  SET next_full_number = CASE WHEN NOT v_manual_number AND v_type = 'full' THEN v_next + 1 ELSE next_full_number END,
      next_abbreviated_number = CASE WHEN NOT v_manual_number AND v_type = 'abbreviated' THEN v_next + 1 ELSE next_abbreviated_number END,
      last_sequence_key = CASE WHEN NOT v_manual_number AND v_type = 'full' THEN v_key ELSE last_sequence_key END,
      last_invoice_number = CASE WHEN NOT v_manual_number AND v_type = 'full' THEN v_next ELSE last_invoice_number END,
      abbreviated_last_sequence_key = CASE WHEN NOT v_manual_number AND v_type = 'abbreviated' THEN v_key ELSE abbreviated_last_sequence_key END,
      abbreviated_last_invoice_number = CASE WHEN NOT v_manual_number AND v_type = 'abbreviated' THEN v_next ELSE abbreviated_last_invoice_number END
  WHERE id = 'main';

  IF NOT v_manual_number THEN
    INSERT INTO public.vat_number_sequences (document_type, sequence_key, last_number)
    VALUES (v_type, v_key, v_next)
    ON CONFLICT (document_type, sequence_key)
    DO UPDATE SET last_number = EXCLUDED.last_number, updated_at = NOW();
  END IF;

  UPDATE public.vat_documents
  SET status = 'issued',
      document_type = v_type,
      document_number = v_number,
      business_snapshot = jsonb_build_object(
        'name', v_settings.business_name,
        'seller_name', v_settings.seller_name,
        'tax_id', v_settings.business_tax_id,
        'address', v_settings.business_address,
        'branch', v_settings.business_branch,
        'phone', v_settings.business_phone,
        'footer_note', CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_footer_note ELSE v_settings.footer_note END
      ),
      issued_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  INSERT INTO public.vat_document_events (document_id, action, detail)
  VALUES (p_document_id, 'issued', jsonb_build_object('document_number', v_number, 'document_type', v_type));

  RETURN v_doc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_vat_document(UUID, TEXT) TO authenticated;
