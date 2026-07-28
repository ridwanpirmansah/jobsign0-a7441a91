CREATE TABLE public.shopee_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  shop_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  lookback_days integer NOT NULL DEFAULT 7,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  last_sync_inserted integer DEFAULT 0,
  last_sync_updated integer DEFAULT 0,
  last_sync_skipped integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopee_settings_singleton CHECK (id = 1)
);

GRANT SELECT ON public.shopee_settings TO authenticated;
GRANT ALL ON public.shopee_settings TO service_role;

ALTER TABLE public.shopee_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/owner dapat melihat pengaturan Shopee"
  ON public.shopee_settings FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));

CREATE POLICY "Owner dapat mengubah pengaturan Shopee"
  ON public.shopee_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER update_shopee_settings_updated_at
  BEFORE UPDATE ON public.shopee_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.shopee_settings (id) VALUES (1);

CREATE TABLE public.shopee_order_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_sn text NOT NULL UNIQUE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  shopee_status text,
  raw jsonb,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shopee_order_map_order_id_idx ON public.shopee_order_map(order_id);

GRANT SELECT ON public.shopee_order_map TO authenticated;
GRANT ALL ON public.shopee_order_map TO service_role;

ALTER TABLE public.shopee_order_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/owner dapat melihat pemetaan pesanan Shopee"
  ON public.shopee_order_map FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER update_shopee_order_map_updated_at
  BEFORE UPDATE ON public.shopee_order_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();