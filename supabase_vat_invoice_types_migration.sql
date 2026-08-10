-- SMALL CAMERA — add full and abbreviated VAT invoice types
-- Run once in Supabase SQL Editor after supabase_vat_migration.sql.

ALTER TABLE public.vat_settings
  ADD COLUMN IF NOT EXISTS seller_name TEXT,
  ADD COLUMN IF NOT EXISTS abbreviated_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS abbreviated_invoice_prefix TEXT NOT NULL DEFAULT 'ABB',
  ADD COLUMN IF NOT EXISTS abbreviated_sequence_reset TEXT NOT NULL DEFAULT 'yearly',
  ADD COLUMN IF NOT EXISTS abbreviated_last_sequence_key TEXT,
  ADD COLUMN IF NOT EXISTS abbreviated_last_invoice_number BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_document_type TEXT NOT NULL DEFAULT 'abbreviated',
  ADD COLUMN IF NOT EXISTS abbreviated_footer_note TEXT;

ALTER TABLE public.vat_settings DROP CONSTRAINT IF EXISTS vat_settings_abbreviated_sequence_reset_check;
ALTER TABLE public.vat_settings ADD CONSTRAINT vat_settings_abbreviated_sequence_reset_check
  CHECK (abbreviated_sequence_reset IN ('yearly','monthly','never'));
ALTER TABLE public.vat_settings DROP CONSTRAINT IF EXISTS vat_settings_default_document_type_check;
ALTER TABLE public.vat_settings ADD CONSTRAINT vat_settings_default_document_type_check
  CHECK (default_document_type IN ('full','abbreviated'));

ALTER TABLE public.vat_documents ADD COLUMN IF NOT EXISTS document_type TEXT;
UPDATE public.vat_documents SET document_type = 'full' WHERE document_type IS NULL;
ALTER TABLE public.vat_documents ALTER COLUMN document_type SET DEFAULT 'abbreviated';
ALTER TABLE public.vat_documents ALTER COLUMN document_type SET NOT NULL;
ALTER TABLE public.vat_documents DROP CONSTRAINT IF EXISTS vat_documents_document_type_check;
ALTER TABLE public.vat_documents ADD CONSTRAINT vat_documents_document_type_check
  CHECK (document_type IN ('full','abbreviated'));

CREATE TABLE IF NOT EXISTS public.vat_number_sequences (
  document_type TEXT NOT NULL CHECK (document_type IN ('full','abbreviated')),
  sequence_key  TEXT NOT NULL,
  last_number   BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (document_type, sequence_key)
);

ALTER TABLE public.vat_number_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_vat_number_sequences ON public.vat_number_sequences;
CREATE POLICY auth_vat_number_sequences ON public.vat_number_sequences
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP FUNCTION IF EXISTS public.issue_vat_document(UUID);
DROP FUNCTION IF EXISTS public.issue_vat_document(UUID, TEXT);
CREATE FUNCTION public.issue_vat_document(p_document_id UUID, p_document_type TEXT DEFAULT NULL)
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
  v_initial BIGINT;
BEGIN
  SELECT * INTO v_doc FROM public.vat_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT document not found'; END IF;
  IF v_doc.status = 'issued' THEN RETURN v_doc; END IF;
  IF v_doc.status = 'void' THEN RAISE EXCEPTION 'Voided VAT document cannot be issued'; END IF;

  SELECT * INTO v_settings FROM public.vat_settings WHERE id = 'main' FOR UPDATE;
  v_type := COALESCE(p_document_type, v_doc.document_type, v_settings.default_document_type, 'abbreviated');
  IF v_type NOT IN ('full', 'abbreviated') THEN RAISE EXCEPTION 'Invalid VAT document type'; END IF;
  IF v_type = 'abbreviated' AND NOT v_settings.abbreviated_enabled THEN
    RAISE EXCEPTION 'Abbreviated VAT invoices are disabled';
  END IF;
  IF v_type = 'full' AND (NULLIF(BTRIM(v_doc.customer_name), '') IS NULL OR NULLIF(BTRIM(v_doc.customer_address), '') IS NULL) THEN
    RAISE EXCEPTION 'Full VAT invoice requires customer name and address';
  END IF;

  v_prefix := CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_invoice_prefix ELSE v_settings.invoice_prefix END;
  v_reset := CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_sequence_reset ELSE v_settings.sequence_reset END;
  v_key := CASE v_reset
    WHEN 'monthly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
    WHEN 'yearly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
    ELSE 'all'
  END;
  v_initial := CASE
    WHEN v_type = 'full' AND v_settings.last_sequence_key = v_key THEN v_settings.last_invoice_number
    WHEN v_type = 'abbreviated' AND v_settings.abbreviated_last_sequence_key = v_key THEN v_settings.abbreviated_last_invoice_number
    ELSE 0
  END;

  INSERT INTO public.vat_number_sequences (document_type, sequence_key, last_number)
  VALUES (v_type, v_key, v_initial)
  ON CONFLICT (document_type, sequence_key) DO NOTHING;
  SELECT last_number + 1 INTO v_next
  FROM public.vat_number_sequences
  WHERE document_type = v_type AND sequence_key = v_key
  FOR UPDATE;
  UPDATE public.vat_number_sequences SET last_number = v_next, updated_at = NOW()
  WHERE document_type = v_type AND sequence_key = v_key;

  v_number := v_prefix || '-' ||
    CASE WHEN v_reset = 'monthly'
      THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
      ELSE TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
    END || '-' || LPAD(v_next::TEXT, 6, '0');

  UPDATE public.vat_settings
  SET last_sequence_key = CASE WHEN v_type = 'full' THEN v_key ELSE last_sequence_key END,
      last_invoice_number = CASE WHEN v_type = 'full' THEN v_next ELSE last_invoice_number END,
      abbreviated_last_sequence_key = CASE WHEN v_type = 'abbreviated' THEN v_key ELSE abbreviated_last_sequence_key END,
      abbreviated_last_invoice_number = CASE WHEN v_type = 'abbreviated' THEN v_next ELSE abbreviated_last_invoice_number END
  WHERE id = 'main';

  UPDATE public.vat_documents
  SET status = 'issued', document_type = v_type, document_number = v_number,
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
