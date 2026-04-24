-- ================================================================
-- CamShop — Supabase Migration v2
-- วิธีใช้: คัดลอกทั้งหมด → SQL Editor → Run
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== TABLE: products =====
CREATE TABLE IF NOT EXISTS products (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_number    TEXT NOT NULL,
  model            TEXT NOT NULL,
  condition        SMALLINT NOT NULL CHECK (condition BETWEEN 1 AND 5),
  images           TEXT[] DEFAULT '{}',
  base_cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Reserved','Sold')),
  sold_price       NUMERIC(12,2),
  sold_date        TIMESTAMPTZ,
  warranty_expiry  TIMESTAMPTZ,
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
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type         TEXT NOT NULL CHECK (type IN ('Income','Expense')),
  category     TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  accessory_id UUID REFERENCES accessories(id) ON DELETE SET NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- ===== TRIGGER: auto Expense เมื่อรับสินค้าเข้า =====
CREATE OR REPLACE FUNCTION auto_tx_product_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO transactions (date, type, category, amount, product_id, note)
  VALUES (NOW(), 'Expense', 'Buy Stock', NEW.base_cost, NEW.id,
          'ซื้อสินค้าเข้าสต็อก: ' || NEW.model || ' SN:' || NEW.serial_number);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_tx_product_insert
  AFTER INSERT ON products FOR EACH ROW EXECUTE FUNCTION auto_tx_product_insert();

-- ===== TRIGGER: auto บวก total_cost + Expense เมื่อเพิ่มอุปกรณ์เสริม =====
CREATE OR REPLACE FUNCTION auto_tx_accessory_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products SET total_cost = total_cost + NEW.cost WHERE id = NEW.product_id;
  INSERT INTO transactions (date, type, category, amount, product_id, accessory_id, note)
  VALUES (NOW(), 'Expense', 'Add-on', NEW.cost, NEW.product_id, NEW.id,
          'เพิ่มอุปกรณ์เสริม: ' || NEW.name);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_tx_accessory_insert
  AFTER INSERT ON accessories FOR EACH ROW EXECUTE FUNCTION auto_tx_accessory_insert();

-- ===== TRIGGER: auto หัก total_cost + ลบ tx เมื่อลบอุปกรณ์เสริม =====
CREATE OR REPLACE FUNCTION auto_fix_accessory_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products SET total_cost = total_cost - OLD.cost WHERE id = OLD.product_id;
  DELETE FROM transactions WHERE accessory_id = OLD.id;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_fix_accessory_delete
  BEFORE DELETE ON accessories FOR EACH ROW EXECUTE FUNCTION auto_fix_accessory_delete();

-- ===== TRIGGER: auto Income + warranty เมื่อขาย =====
CREATE OR REPLACE FUNCTION auto_tx_sold()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Sold' AND OLD.status != 'Sold' THEN
    NEW.sold_date      := NOW();
    NEW.warranty_expiry := NOW() + INTERVAL '15 days';
    INSERT INTO transactions (date, type, category, amount, product_id, note)
    VALUES (NOW(), 'Income', 'Sale', NEW.sold_price, NEW.id,
            'ขายสินค้า: ' || NEW.model || ' SN:' || NEW.serial_number);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_tx_sold
  BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION auto_tx_sold();

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

CREATE POLICY "auth_products"     ON products     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_accessories"  ON accessories  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_transactions" ON transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== STORAGE BUCKET =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images','product-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read"    ON storage.objects FOR SELECT TO public      USING (bucket_id = 'product-images');
CREATE POLICY "auth_upload"    ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "auth_delete"    ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images');
