-- SMALL CAMERA — repair and protect product total costs
-- Run once in Supabase SQL Editor for an existing project.

CREATE OR REPLACE FUNCTION public.sync_product_total_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  accessory_total NUMERIC(12,2);
BEGIN
  IF NEW.base_cost IS DISTINCT FROM OLD.base_cost THEN
    SELECT COALESCE(SUM(cost), 0)
      INTO accessory_total
      FROM public.accessories
     WHERE product_id = NEW.id;
    NEW.total_cost := NEW.base_cost + accessory_total;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_total_cost ON public.products;
CREATE TRIGGER trg_sync_product_total_cost
  BEFORE UPDATE OF base_cost ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_total_cost();

-- Repair old rows where base cost was edited but total cost stayed stale.
UPDATE public.products AS product
SET total_cost = product.base_cost + COALESCE((
  SELECT SUM(accessory.cost)
  FROM public.accessories AS accessory
  WHERE accessory.product_id = product.id
), 0)
WHERE product.total_cost IS DISTINCT FROM product.base_cost + COALESCE((
  SELECT SUM(accessory.cost)
  FROM public.accessories AS accessory
  WHERE accessory.product_id = product.id
), 0);
