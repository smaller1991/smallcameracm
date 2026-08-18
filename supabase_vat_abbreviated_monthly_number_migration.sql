-- SMALL CAMERA — abbreviated VAT invoices use the same monthly format as full invoices.
-- Run once in Supabase SQL Editor after supabase_vat_flexible_editing_migration.sql.

UPDATE public.vat_settings
SET abbreviated_invoice_prefix = COALESCE(NULLIF(BTRIM(invoice_prefix), ''), 'SM'),
    abbreviated_sequence_reset = 'monthly',
    next_abbreviated_number = GREATEST(
      COALESCE(next_abbreviated_number, 1),
      COALESCE(next_full_number, 1)
    )
WHERE id = 'main';

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
  v_manual_number BOOLEAN;
  v_shared_prefix BOOLEAN;
BEGIN
  SELECT * INTO v_doc FROM public.vat_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VAT document not found'; END IF;
  IF v_doc.status = 'issued' THEN RETURN v_doc; END IF;
  IF v_doc.status = 'void' THEN RAISE EXCEPTION 'Voided VAT document cannot be issued'; END IF;

  SELECT * INTO v_settings FROM public.vat_settings WHERE id = 'main' FOR UPDATE;
  v_type := COALESCE(p_document_type, v_doc.document_type, v_settings.default_document_type, 'abbreviated');
  IF v_type NOT IN ('full', 'abbreviated') THEN RAISE EXCEPTION 'Invalid VAT document type'; END IF;
  IF v_type = 'abbreviated' AND NOT v_settings.abbreviated_enabled THEN RAISE EXCEPTION 'Abbreviated VAT invoices are disabled'; END IF;

  v_prefix := CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_invoice_prefix ELSE v_settings.invoice_prefix END;
  v_reset := CASE WHEN v_type = 'abbreviated' THEN 'monthly' ELSE v_settings.sequence_reset END;
  v_key := CASE v_reset
    WHEN 'monthly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
    WHEN 'yearly' THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
    ELSE 'all'
  END;
  v_number := NULLIF(BTRIM(v_doc.document_number), '');
  v_manual_number := v_number IS NOT NULL;
  v_shared_prefix := v_settings.abbreviated_enabled
    AND v_settings.abbreviated_invoice_prefix = v_settings.invoice_prefix;

  IF NOT v_manual_number THEN
    v_next := CASE WHEN v_type = 'abbreviated' THEN v_settings.next_abbreviated_number ELSE v_settings.next_full_number END;
    v_next := GREATEST(COALESCE(v_next, 1), 1);
    IF v_shared_prefix THEN
      v_next := GREATEST(v_next, COALESCE(v_settings.next_full_number, 1), COALESCE(v_settings.next_abbreviated_number, 1));
    END IF;
    v_number := v_prefix || '-' ||
      CASE WHEN v_reset = 'monthly'
        THEN TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYYMM')
        ELSE TO_CHAR(v_doc.document_date AT TIME ZONE 'Asia/Bangkok', 'YYYY')
      END || '-' || LPAD(v_next::TEXT, 6, '0');
  END IF;

  UPDATE public.vat_settings
  SET next_full_number = CASE
        WHEN NOT v_manual_number AND (v_type = 'full' OR v_shared_prefix) THEN GREATEST(next_full_number, v_next + 1)
        ELSE next_full_number END,
      next_abbreviated_number = CASE
        WHEN NOT v_manual_number AND (v_type = 'abbreviated' OR v_shared_prefix) THEN GREATEST(next_abbreviated_number, v_next + 1)
        ELSE next_abbreviated_number END,
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
  SET status = 'issued', document_type = v_type, document_number = v_number,
      business_snapshot = jsonb_build_object(
        'name', v_settings.business_name, 'seller_name', v_settings.seller_name,
        'tax_id', v_settings.business_tax_id, 'address', v_settings.business_address,
        'branch', v_settings.business_branch, 'phone', v_settings.business_phone,
        'footer_note', CASE WHEN v_type = 'abbreviated' THEN v_settings.abbreviated_footer_note ELSE v_settings.footer_note END
      ), issued_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  INSERT INTO public.vat_document_events (document_id, action, detail)
  VALUES (p_document_id, 'issued', jsonb_build_object('document_number', v_number, 'document_type', v_type, 'automatic_sequence', NOT v_manual_number));
  RETURN v_doc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_vat_document(UUID, TEXT) TO authenticated;
