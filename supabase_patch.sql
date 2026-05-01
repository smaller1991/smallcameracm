-- ================================================================
-- CamShop — Supabase Patch (รัน 1 ครั้ง สำหรับ DB ที่มีอยู่แล้ว)
-- วิธีใช้: คัดลอกทั้งหมด → Supabase SQL Editor → Run
-- ================================================================

-- ===== ลบ trigger เก่าที่ทับซ้อนกับ JS code =====
-- trigger นี้สร้าง Buy Stock อัตโนมัติ แต่ AddProduct JS ทำเองแล้ว → ซ้ำกัน
DROP TRIGGER IF EXISTS trg_auto_tx_product_insert ON products;
DROP FUNCTION IF EXISTS auto_tx_product_insert();

-- trigger นี้สร้าง Sale อัตโนมัติ แต่ ProductDetail JS ทำเองแล้ว → ซ้ำกัน
DROP TRIGGER IF EXISTS trg_auto_tx_sold ON products;
DROP FUNCTION IF EXISTS auto_tx_sold();

-- trigger นี้สร้าง Add-on อัตโนมัติ แต่ ProductDetail JS ทำเองแล้ว → ซ้ำกัน
DROP TRIGGER IF EXISTS trg_auto_tx_accessory_insert ON accessories;
DROP FUNCTION IF EXISTS auto_tx_accessory_insert();

-- trigger บน accessories ที่อัปเดต total_cost ไม่ถูกต้อง → JS จัดการเองแล้ว
DROP TRIGGER IF EXISTS trg_update_total_cost_on_acc_insert ON accessories;
DROP TRIGGER IF EXISTS trg_update_total_cost_on_acc_delete ON accessories;
DROP TRIGGER IF EXISTS trg_sync_acc_cost ON accessories;
DROP FUNCTION IF EXISTS update_total_cost_on_acc_insert();
DROP FUNCTION IF EXISTS update_total_cost_on_acc_delete();
DROP FUNCTION IF EXISTS sync_acc_cost();

-- ===== เพิ่ม column ที่ขาดใน transactions =====
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS images         TEXT[] DEFAULT '{}';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS trade_sell_a   NUMERIC(12,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS trade_profit_a NUMERIC(12,2);

-- ===== เพิ่ม column ที่ขาดใน products =====
ALTER TABLE products ADD COLUMN IF NOT EXISTS category       TEXT DEFAULT 'กล้อง';
ALTER TABLE products ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS customer_note  TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_trade_in    BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS trade_ref_id   UUID;

-- ===== เพิ่ม table balances (ถ้ายังไม่มี) =====
CREATE TABLE IF NOT EXISTS balances (
  id         TEXT PRIMARY KEY DEFAULT 'main',
  bank       NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash       NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO balances (id, bank, cash) VALUES ('main', 0, 0) ON CONFLICT (id) DO NOTHING;

ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "auth_balances" ON balances FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===== ผ่อนจ่าย: เพิ่ม Pending status + installment columns =====
-- ลบ check constraint เก่าของ status แล้วสร้างใหม่รวม 'Pending'
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check
  CHECK (status IN ('Available','Reserved','Sold','Pending'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS installment_total NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS installment_paid  NUMERIC(12,2) DEFAULT 0;

-- ===== Storage bucket: receipt-images (ถ้ายังไม่มี) =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipt-images','receipt-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "receipt_public_read" ON storage.objects FOR SELECT TO public      USING (bucket_id = 'receipt-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "receipt_auth_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipt-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "receipt_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'receipt-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
