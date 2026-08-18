-- SMALL CAMERA — safe VAT document corrections and test-sequence maintenance.
-- Run once in Supabase SQL Editor after the VAT invoice-type migrations.

ALTER TABLE public.vat_documents
  ADD COLUMN IF NOT EXISTS replaces_document_id UUID,
  ADD COLUMN IF NOT EXISTS replaced_by_document_id UUID,
  ADD COLUMN IF NOT EXISTS replacement_of_number TEXT;

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

CREATE OR REPLACE FUNCTION public.renumber_vat_test_document(p_document_id UUID, p_sequence BIGINT)
RETURNS public.vat_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_doc public.vat_documents;
  v_settings public.vat_settings;
  v_reset TEXT;
  v_prefix TEXT;
  v_key TEXT;
  v_period TEXT;
  v_old_number TEXT;
  v_new_number TEXT;
  v_max BIGINT;
BEGIN
  IF p_sequence IS NULL OR p_sequence < 1 THEN
    RAISE EXCEPTION 'Sequence must be at least 1';
  END IF;

  SELECT * INTO v_doc FROM public.vat_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT document not found'; END IF;
  IF v_doc.status <> 'issued' THEN RAISE EXCEPTION 'Only issued test documents can be renumbered'; END IF;

  SELECT * INTO v_settings FROM public.vat_settings WHERE id = 'main' FOR UPDATE;
  v_reset := CASE WHEN v_doc.document_type = 'abbreviated' THEN v_settings.abbreviated_sequence_reset ELSE v_settings.sequence_reset END;
  v_prefix := CASE WHEN v_doc.document_type = 'abbreviated' THEN v_settings.abbreviated_invoice_prefix ELSE v_settings.invoice_prefix END;
  v_key := CASE v_reset
    WHEN 'monthly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
    WHEN 'yearly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
    ELSE 'all'
  END;
  v_period := CASE WHEN v_reset = 'monthly'
    THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
    ELSE TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
  END;
  v_old_number := v_doc.document_number;
  v_new_number := v_prefix || '-' || v_period || '-' || LPAD(p_sequence::TEXT, 6, '0');

  UPDATE public.vat_documents
  SET document_number = v_new_number
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  SELECT COALESCE(MAX(SUBSTRING(d.document_number FROM '([0-9]+)$')::BIGINT), 0)
  INTO v_max
  FROM public.vat_documents d
  WHERE d.status = 'issued'
    AND d.document_type = v_doc.document_type
    AND d.document_number LIKE v_prefix || '-%'
    AND (
      v_reset = 'never'
      OR CASE v_reset
        WHEN 'monthly' THEN TO_CHAR(d.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
        ELSE TO_CHAR(d.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
      END = v_key
    );

  INSERT INTO public.vat_number_sequences (document_type, sequence_key, last_number)
  VALUES (v_doc.document_type, v_key, v_max)
  ON CONFLICT (document_type, sequence_key)
  DO UPDATE SET last_number = EXCLUDED.last_number, updated_at = NOW();

  UPDATE public.vat_settings
  SET last_sequence_key = CASE WHEN v_doc.document_type = 'full' THEN v_key ELSE last_sequence_key END,
      last_invoice_number = CASE WHEN v_doc.document_type = 'full' THEN v_max ELSE last_invoice_number END,
      abbreviated_last_sequence_key = CASE WHEN v_doc.document_type = 'abbreviated' THEN v_key ELSE abbreviated_last_sequence_key END,
      abbreviated_last_invoice_number = CASE WHEN v_doc.document_type = 'abbreviated' THEN v_max ELSE abbreviated_last_invoice_number END
  WHERE id = 'main';

  INSERT INTO public.vat_document_events (document_id, action, detail)
  VALUES (p_document_id, 'test_document_renumbered', jsonb_build_object('before', v_old_number, 'after', v_new_number));

  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_vat_test_document(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_doc public.vat_documents;
  v_settings public.vat_settings;
  v_reset TEXT;
  v_prefix TEXT;
  v_key TEXT;
  v_max BIGINT;
BEGIN
  SELECT * INTO v_doc FROM public.vat_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT document not found'; END IF;
  IF v_doc.status <> 'issued' THEN RAISE EXCEPTION 'Only issued test documents can be deleted'; END IF;

  SELECT * INTO v_settings FROM public.vat_settings WHERE id = 'main' FOR UPDATE;
  v_reset := CASE WHEN v_doc.document_type = 'abbreviated' THEN v_settings.abbreviated_sequence_reset ELSE v_settings.sequence_reset END;
  v_prefix := CASE WHEN v_doc.document_type = 'abbreviated' THEN v_settings.abbreviated_invoice_prefix ELSE v_settings.invoice_prefix END;
  v_key := CASE v_reset
    WHEN 'monthly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
    WHEN 'yearly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
    ELSE 'all'
  END;

  DELETE FROM public.vat_documents WHERE id = p_document_id;

  SELECT COALESCE(MAX(SUBSTRING(d.document_number FROM '([0-9]+)$')::BIGINT), 0)
  INTO v_max
  FROM public.vat_documents d
  WHERE d.status = 'issued'
    AND d.document_type = v_doc.document_type
    AND d.document_number LIKE v_prefix || '-%'
    AND (
      v_reset = 'never'
      OR CASE v_reset
        WHEN 'monthly' THEN TO_CHAR(d.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
        ELSE TO_CHAR(d.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
      END = v_key
    );

  INSERT INTO public.vat_number_sequences (document_type, sequence_key, last_number)
  VALUES (v_doc.document_type, v_key, v_max)
  ON CONFLICT (document_type, sequence_key)
  DO UPDATE SET last_number = EXCLUDED.last_number, updated_at = NOW();

  UPDATE public.vat_settings
  SET last_sequence_key = CASE WHEN v_doc.document_type = 'full' THEN v_key ELSE last_sequence_key END,
      last_invoice_number = CASE WHEN v_doc.document_type = 'full' THEN v_max ELSE last_invoice_number END,
      abbreviated_last_sequence_key = CASE WHEN v_doc.document_type = 'abbreviated' THEN v_key ELSE abbreviated_last_sequence_key END,
      abbreviated_last_invoice_number = CASE WHEN v_doc.document_type = 'abbreviated' THEN v_max ELSE abbreviated_last_invoice_number END
  WHERE id = 'main';

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_vat_document_replacement(p_document_id UUID)
RETURNS public.vat_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_original public.vat_documents;
  v_replacement public.vat_documents;
  v_reason TEXT;
BEGIN
  SELECT * INTO v_original FROM public.vat_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT document not found'; END IF;
  IF v_original.status <> 'issued' THEN RAISE EXCEPTION 'Only issued documents can be replaced'; END IF;
  IF v_original.replaced_by_document_id IS NOT NULL THEN RAISE EXCEPTION 'This document already has a replacement'; END IF;

  v_reason := 'ยกเลิกเพื่อออกใบกำกับภาษีฉบับใหม่แทนเลขที่ ' || COALESCE(v_original.document_number, '-');

  INSERT INTO public.vat_documents (
    source_key, source_type, source_transaction_ids, source_sale_batch_id,
    status, document_type, document_date,
    customer_name, customer_tax_id, customer_address, customer_branch, customer_phone,
    items, subtotal, vat_rate, vat_amount, total_amount, payment_method, note,
    business_snapshot, replaces_document_id, replacement_of_number
  ) VALUES (
    v_original.source_key || ':replacement:' || v_original.id::TEXT || ':' || TO_CHAR(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    v_original.source_type, v_original.source_transaction_ids, v_original.source_sale_batch_id,
    'draft', v_original.document_type, v_original.document_date,
    v_original.customer_name, v_original.customer_tax_id, v_original.customer_address, v_original.customer_branch, v_original.customer_phone,
    v_original.items, v_original.subtotal, v_original.vat_rate, v_original.vat_amount, v_original.total_amount,
    v_original.payment_method, v_original.note, '{}'::jsonb, v_original.id, v_original.document_number
  ) RETURNING * INTO v_replacement;

  UPDATE public.vat_documents
  SET status = 'void', voided_at = NOW(), void_reason = v_reason, replaced_by_document_id = v_replacement.id
  WHERE id = v_original.id;

  UPDATE public.transactions
  SET vat_document_id = v_replacement.id
  WHERE vat_document_id = v_original.id;

  INSERT INTO public.vat_document_events (document_id, action, detail)
  VALUES
    (v_original.id, 'issued_document_replaced', jsonb_build_object('replacement_document_id', v_replacement.id, 'reason', v_reason)),
    (v_replacement.id, 'replacement_draft_created', jsonb_build_object('original_document_id', v_original.id, 'original_document_number', v_original.document_number));

  RETURN v_replacement;
END;
$$;

GRANT EXECUTE ON FUNCTION public.renumber_vat_test_document(UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vat_test_document(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vat_document_replacement(UUID) TO authenticated;
