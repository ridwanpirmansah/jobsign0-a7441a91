CREATE TABLE public.shopee_shops (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id text NOT NULL UNIQUE,
  shop_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopee_shops TO authenticated;
GRANT ALL ON public.shopee_shops TO service_role;

ALTER TABLE public.shopee_shops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin owner manage shopee shops"
ON public.shopee_shops
FOR ALL
TO authenticated
USING (public.is_admin_or_owner(auth.uid()))
WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER update_shopee_shops_updated_at
BEFORE UPDATE ON public.shopee_shops
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shopee_shop_id text;

INSERT INTO public.shopee_shops (shop_id, access_token, refresh_token, token_expires_at, connected_at, active)
SELECT shop_id, access_token, refresh_token, token_expires_at, connected_at, true
FROM public.shopee_settings
WHERE id = 1 AND shop_id IS NOT NULL AND refresh_token IS NOT NULL
ON CONFLICT (shop_id) DO NOTHING;

UPDATE public.orders o
SET shopee_shop_id = s.shop_id
FROM public.shopee_settings s
WHERE s.id = 1 AND s.shop_id IS NOT NULL AND o.source = 'shopee' AND o.shopee_shop_id IS NULL;