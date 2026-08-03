-- SMALL CAMERA — Fresh Supabase setup
-- ใช้กับ Supabase project ใหม่ที่ไม่ต้องการย้ายข้อมูลเดิมเท่านั้น

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================
-- Tables
-- =========================

CREATE TABLE IF NOT EXISTS public.products (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_number       TEXT NOT NULL,
  model               TEXT NOT NULL,
  condition           SMALLINT NOT NULL CHECK (condition BETWEEN 1 AND 5),
  category            TEXT NOT NULL DEFAULT 'กล้อง',
  base_cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'Available'
                      CHECK (status IN ('Available','Reserved','Sold','Pending')),
  sold_price          NUMERIC(12,2),
  sold_date           TIMESTAMPTZ,
  warranty_expiry     TIMESTAMPTZ,
  payment_method      TEXT,
  customer_note       TEXT,
  is_trade_in         BOOLEAN NOT NULL DEFAULT false,
  trade_ref_id        UUID,
  notes               TEXT,
  images              TEXT[] NOT NULL DEFAULT '{}',
  batch_id            UUID,
  sale_batch_id       UUID,
  installment_total   NUMERIC(12,2),
  installment_paid    NUMERIC(12,2) DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.accessories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type            TEXT NOT NULL CHECK (type IN ('Income','Expense')),
  category        TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  accessory_id    UUID REFERENCES public.accessories(id) ON DELETE SET NULL,
  payment_method  TEXT,
  bank_amount     NUMERIC(12,2),
  cash_amount     NUMERIC(12,2),
  bank_after      NUMERIC(12,2),
  cash_after      NUMERIC(12,2),
  images          TEXT[] DEFAULT '{}',
  note            TEXT,
  trade_sell_a    NUMERIC(12,2),
  trade_profit_a  NUMERIC(12,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.balances (
  id          TEXT PRIMARY KEY DEFAULT 'main',
  bank        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash        NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.balances (id, bank, cash)
VALUES ('main', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- trade_ref_id is optional and must not block deleting an old linked product.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_trade_ref_id_fkey;
ALTER TABLE public.products
  ADD CONSTRAINT products_trade_ref_id_fkey
  FOREIGN KEY (trade_ref_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- =========================
-- Indexes
-- =========================

CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_batch_id ON public.products(batch_id);
CREATE INDEX IF NOT EXISTS idx_products_sale_batch_id ON public.products(sale_batch_id);
CREATE INDEX IF NOT EXISTS idx_accessories_product_id ON public.accessories(product_id);
CREATE INDEX IF NOT EXISTS idx_transactions_product_id ON public.transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type);

-- =========================
-- updated_at triggers
-- =========================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- Row Level Security
-- =========================

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accessories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_products ON public.products;
CREATE POLICY auth_products ON public.products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_accessories ON public.accessories;
CREATE POLICY auth_accessories ON public.accessories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_transactions ON public.transactions;
CREATE POLICY auth_transactions ON public.transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_balances ON public.balances;
CREATE POLICY auth_balances ON public.balances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================
-- Storage buckets and rules
-- =========================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('product-images', 'product-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp']),
  ('receipt-images', 'receipt-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
CREATE POLICY product_images_public_read ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_auth_upload ON storage.objects;
CREATE POLICY product_images_auth_upload ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_auth_delete ON storage.objects;
CREATE POLICY product_images_auth_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS receipt_images_public_read ON storage.objects;
CREATE POLICY receipt_images_public_read ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'receipt-images');

DROP POLICY IF EXISTS receipt_images_auth_upload ON storage.objects;
CREATE POLICY receipt_images_auth_upload ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipt-images');

DROP POLICY IF EXISTS receipt_images_auth_delete ON storage.objects;
CREATE POLICY receipt_images_auth_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'receipt-images');
