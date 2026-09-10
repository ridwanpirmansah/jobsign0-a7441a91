DROP INDEX IF EXISTS shopee_order_map_sn_shop_uidx;
ALTER TABLE public.shopee_order_map ALTER COLUMN shop_id SET DEFAULT '';
UPDATE public.shopee_order_map SET shop_id = '' WHERE shop_id IS NULL;
ALTER TABLE public.shopee_order_map ALTER COLUMN shop_id SET NOT NULL;
ALTER TABLE public.shopee_order_map ADD CONSTRAINT shopee_order_map_sn_shop_key UNIQUE (order_sn, shop_id);