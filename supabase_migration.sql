-- ================================================================
-- CamShop — Supabase Migration v3
-- วิธีใช้: คัดลอกทั้งหมด → SQL Editor → Run
-- (ถ้ามี DB อยู่แล้ว ให้รัน supabase_patch.sql แทน)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== TABLE: products =====
CREATE TABLE IF NOT EXISTS products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_number    TEXT NOT NULL,
  model            TEXT NOT NULL,
  condition        SMALLINT NOT NULL CHECK (condition BETWEEN 1 AND 5),
  category         TEXT DEFAULT 'กล้อง',
  base_cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Reserved','Sold')),
  sold_price       NUMERIC(12,2),
  sold_date        TIMESTAMPTZ,
  warranty_expiry  TIMESTAMPTZ,
  payment_method   TEXT,
  customer_note    TEXT,
  is_trade_in      BOOLEAN DEFAULT false,
  trade_ref_id     UUID,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== TABLE: accessories =====
CREATE TABLE IF NOT EXISTS accessories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== TABLE: transactions =====
CREATE TABLE IF NOT EXISTS transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type           TEXT NOT NULL CHECK (type IN ('Income','Expense')),
  category       TEXT NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  product_id     UUID REFERENCES products(id) ON DELETE SET NULL,
  accessory_id   UUID REFERENCES accessories(id) ON DELETE SET NULL,
  payment_method TEXT,
  images         TEXT[] DEFAULT '{}',
  note           TEXT,
  trade_sell_a   NUMERIC(12,2),
  trade_profit_a NUMERIC(12,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== TABLE: balances =====
CREATE TABLE IF NOT EXISTS balances (
  id         TEXT PRIMARY KEY DEFAULT 'main',
  bank       NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash       NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO balances (id, bank, cash) VALUES ('main', 0, 0) ON CONFLICT (id) DO NOTHING;

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_products_status     ON products(status);
CREATE INDEX IF NOT EXISTS idx_accessories_product ON accessories(product_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date   ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type   ON transactions(type);

-- ===== TRIGGER: updated_at =====
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== TRIGGER: sync total_cost เมื่อแก้ base_cost =====
CREATE OR REPLACE FUNCTION sync_total_cost()
RETURNS TRIGGER AS $$
DECLARE acc_sum NUMERIC(12,2);
BEGIN
  IF NEW.base_cost != OLD.base_cost THEN
    SELECT COALESCE(SUM(cost),0) INTO acc_sum FROM accessories WHERE product_id = NEW.id;
    NEW.total_cost := NEW.base_cost + acc_sum;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_total_cost
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION sync_total_cost();

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE accessories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE balances     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_products"     ON products     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_accessories"  ON accessories  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_transactions" ON transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_balances"     ON balances     FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== STORAGE BUCKET: receipt-images =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipt-images','receipt-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "receipt_public_read" ON storage.objects FOR SELECT TO public      USING (bucket_id = 'receipt-images');
CREATE POLICY "receipt_auth_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipt-images');
CREATE POLICY "receipt_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'receipt-images');
