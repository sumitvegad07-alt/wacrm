-- ============================================================================
-- Stock Management v1.1 — feedback pass
--   • Reason-coded voucher numbers on manual movements (PU-000012, SR-000034…)
--   • Richer, direction-aware reasons (adds Purchase, Production, Opening Load,
--     Purchase Return)
--   • Manual adjustments log to module_activities so they appear on the product
--     timeline (detail page)
--   • Bulk import RPC (stock_bulk_adjust) for the CSV / accounting import
-- Existing v1 rows stay valid (old reasons are a subset of the new list).
-- ============================================================================

-- 1. Voucher number on the ledger (manual movements only; auto rows use source_ref).
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS voucher_no text;

-- 2. Expanded manual-reason list (still an explicit IS NOT NULL to defeat the
--    NULL-in-CHECK trap fixed in v1).
ALTER TABLE public.stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_manual_reason_chk;
ALTER TABLE public.stock_ledger ADD CONSTRAINT stock_ledger_manual_reason_chk
  CHECK (
    entry_type NOT IN ('manual_in','manual_out')
    OR (reason_code IS NOT NULL AND reason_code IN (
      'Purchase','Sales Return','Production','Opening Load','Transfer In',
      'Transfer Out','Damage','Expiry','Theft/Loss','Purchase Return',
      'Stock Correction','Physical Count Adjustment'
    ))
  );

-- 3. Per-account, per-prefix voucher counter (a table, not 12 columns).
CREATE TABLE IF NOT EXISTS public.stock_voucher_sequences (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  prefix     text NOT NULL,
  last_no    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, prefix)
);
ALTER TABLE public.stock_voucher_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_voucher_sequences_select ON public.stock_voucher_sequences;
CREATE POLICY stock_voucher_sequences_select ON public.stock_voucher_sequences
  FOR SELECT USING (public.is_account_member(account_id));

-- 4. Reason -> two-letter prefix.
CREATE OR REPLACE FUNCTION public.stock_reason_prefix(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reason
    WHEN 'Purchase' THEN 'PU'
    WHEN 'Sales Return' THEN 'SR'
    WHEN 'Production' THEN 'PN'
    WHEN 'Opening Load' THEN 'OP'
    WHEN 'Transfer In' THEN 'TI'
    WHEN 'Transfer Out' THEN 'TO'
    WHEN 'Damage' THEN 'DM'
    WHEN 'Expiry' THEN 'EX'
    WHEN 'Theft/Loss' THEN 'TL'
    WHEN 'Purchase Return' THEN 'PR'
    WHEN 'Stock Correction' THEN 'SC'
    WHEN 'Physical Count Adjustment' THEN 'PC'
    ELSE 'ST'
  END;
$$;

-- 5. Next voucher number for (account, prefix). Atomic via upsert-returning.
CREATE OR REPLACE FUNCTION public.next_stock_voucher(p_account_id uuid, p_prefix text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no bigint;
BEGIN
  INSERT INTO public.stock_voucher_sequences (account_id, prefix, last_no)
  VALUES (p_account_id, p_prefix, 1)
  ON CONFLICT (account_id, prefix) DO UPDATE SET last_no = stock_voucher_sequences.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN p_prefix || '-' || lpad(v_no::text, 6, '0');
END;
$$;

-- 6. stock_adjust — now stamps a voucher number and logs a product-timeline entry.
CREATE OR REPLACE FUNCTION public.stock_adjust(
  p_product_id uuid, p_quantity numeric, p_direction text,
  p_reason_code text, p_notes text DEFAULT NULL, p_ledger_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_account uuid; v_signed numeric; v_type text; v_id uuid; v_voucher text; v_pname text;
BEGIN
  SELECT account_id, name INTO v_account, v_pname FROM public.products WHERE id = p_product_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Product not found' USING ERRCODE='no_data_found'; END IF;
  IF NOT public.has_permission(auth.uid(), v_account, 'manage_stock') THEN
    RAISE EXCEPTION 'Not permitted to manage stock' USING ERRCODE='insufficient_privilege'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'Direction must be in or out' USING ERRCODE='check_violation'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero' USING ERRCODE='check_violation'; END IF;

  IF p_ledger_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.stock_ledger WHERE id = p_ledger_id;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ledger_id', v_id, 'closing_stock', public.stock_closing(p_product_id));
    END IF;
  END IF;

  v_signed  := CASE WHEN p_direction = 'in' THEN abs(p_quantity) ELSE -abs(p_quantity) END;
  v_type    := CASE WHEN p_direction = 'in' THEN 'manual_in' ELSE 'manual_out' END;
  v_voucher := public.next_stock_voucher(v_account, public.stock_reason_prefix(p_reason_code));

  INSERT INTO public.stock_ledger
    (id, account_id, product_id, quantity, entry_type, reason_code, source_type, voucher_no, notes, created_by)
  VALUES
    (COALESCE(p_ledger_id, gen_random_uuid()), v_account, p_product_id, v_signed, v_type,
     p_reason_code, 'manual', v_voucher, p_notes, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES (v_account, auth.uid(), 'product', p_product_id,
    CASE WHEN p_direction = 'in' THEN 'stock_in' ELSE 'stock_out' END,
    format('%s %s · %s (%s)', CASE WHEN p_direction = 'in' THEN 'Stock In' ELSE 'Stock Out' END,
           abs(p_quantity), p_reason_code, v_voucher),
    jsonb_build_object('voucher_no', v_voucher, 'reason', p_reason_code, 'quantity', abs(p_quantity), 'direction', p_direction));

  RETURN jsonb_build_object('ledger_id', v_id, 'closing_stock', public.stock_closing(p_product_id), 'voucher_no', v_voucher);
END;
$$;

-- 7. Bulk import — one permission check per row (same account), collects per-row
--    errors instead of failing the whole file, stamps vouchers, logs each.
CREATE OR REPLACE FUNCTION public.stock_bulk_adjust(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  r jsonb; v_account uuid; v_prod uuid; v_dir text; v_qty numeric; v_reason text;
  v_signed numeric; v_type text; v_voucher text; v_pname text;
  v_count int := 0; v_errors jsonb := '[]'::jsonb; i int := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be an array' USING ERRCODE = 'check_violation'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    v_prod   := NULLIF(r->>'product_id','')::uuid;
    v_dir    := r->>'direction';
    v_qty    := NULLIF(r->>'quantity','')::numeric;
    v_reason := r->>'reason_code';

    SELECT account_id, name INTO v_account, v_pname FROM public.products WHERE id = v_prod;
    IF v_account IS NULL THEN v_errors := v_errors || jsonb_build_object('row', i, 'error', 'product not found'); CONTINUE; END IF;
    IF NOT public.has_permission(auth.uid(), v_account, 'manage_stock') THEN
      RAISE EXCEPTION 'Not permitted to manage stock' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF v_dir NOT IN ('in','out') OR v_qty IS NULL OR v_qty <= 0 THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'invalid direction or quantity'); CONTINUE; END IF;

    v_signed  := CASE WHEN v_dir = 'in' THEN abs(v_qty) ELSE -abs(v_qty) END;
    v_type    := CASE WHEN v_dir = 'in' THEN 'manual_in' ELSE 'manual_out' END;
    BEGIN
      v_voucher := public.next_stock_voucher(v_account, public.stock_reason_prefix(v_reason));
      INSERT INTO public.stock_ledger
        (account_id, product_id, quantity, entry_type, reason_code, source_type, voucher_no, notes, created_by)
      VALUES (v_account, v_prod, v_signed, v_type, v_reason, 'manual', v_voucher, NULLIF(r->>'notes',''), auth.uid());
      INSERT INTO public.module_activities (account_id, user_id, module_name, record_id, action, message, details)
      VALUES (v_account, auth.uid(), 'product', v_prod,
        CASE WHEN v_dir = 'in' THEN 'stock_in' ELSE 'stock_out' END,
        format('%s %s · %s (%s)', CASE WHEN v_dir = 'in' THEN 'Stock In' ELSE 'Stock Out' END, abs(v_qty), v_reason, v_voucher),
        jsonb_build_object('voucher_no', v_voucher, 'reason', v_reason, 'quantity', abs(v_qty), 'direction', v_dir, 'imported', true));
      v_count := v_count + 1;
    EXCEPTION WHEN check_violation THEN
      v_errors := v_errors || jsonb_build_object('row', i, 'error', 'invalid reason code');
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_count, 'errors', v_errors);
END;
$$;

GRANT EXECUTE ON FUNCTION public.stock_bulk_adjust(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_stock_voucher(uuid, text) TO authenticated;

-- 8. Backfill vouchers for the manual rows already in production, and seed the
--    counters so new vouchers continue from there.
WITH ordered AS (
  SELECT id, account_id, reason_code,
    row_number() OVER (PARTITION BY account_id, public.stock_reason_prefix(reason_code) ORDER BY created_at, id) AS rn
  FROM public.stock_ledger
  WHERE entry_type IN ('manual_in','manual_out') AND voucher_no IS NULL
)
UPDATE public.stock_ledger sl
SET voucher_no = public.stock_reason_prefix(o.reason_code) || '-' || lpad(o.rn::text, 6, '0')
FROM ordered o
WHERE sl.id = o.id;

INSERT INTO public.stock_voucher_sequences (account_id, prefix, last_no)
SELECT account_id, public.stock_reason_prefix(reason_code) AS prefix, count(*)
FROM public.stock_ledger
WHERE entry_type IN ('manual_in','manual_out')
GROUP BY account_id, public.stock_reason_prefix(reason_code)
ON CONFLICT (account_id, prefix)
DO UPDATE SET last_no = GREATEST(stock_voucher_sequences.last_no, EXCLUDED.last_no);
