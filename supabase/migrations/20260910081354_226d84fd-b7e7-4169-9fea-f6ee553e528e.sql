ALTER TABLE public.shopee_order_map ADD COLUMN IF NOT EXISTS shop_id text;

UPDATE public.shopee_order_map m
SET shop_id = s.shop_id
FROM public.shopee_settings s
WHERE s.id = 1 AND m.shop_id IS NULL;

ALTER TABLE public.shopee_order_map DROP CONSTRAINT IF EXISTS shopee_order_map_order_sn_key;
CREATE UNIQUE INDEX IF NOT EXISTS shopee_order_map_sn_shop_uidx ON public.shopee_order_map (order_sn, COALESCE(shop_id, ''));