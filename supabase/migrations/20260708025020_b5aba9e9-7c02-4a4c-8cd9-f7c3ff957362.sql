
CREATE TABLE public.shipping_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shipping_carriers TO authenticated;
GRANT ALL ON public.shipping_carriers TO service_role;
ALTER TABLE public.shipping_carriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read carriers" ON public.shipping_carriers FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage carriers" ON public.shipping_carriers FOR ALL TO authenticated
  USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));

CREATE TRIGGER trg_shipping_carriers_updated
  BEFORE UPDATE ON public.shipping_carriers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.shipping_carriers(name, sort_order) VALUES
  ('JNE', 10), ('J&T', 20), ('SiCepat', 30), ('Anteraja', 40),
  ('Ninja', 50), ('Pos Indonesia', 60), ('ID Express', 70),
  ('Lion Parcel', 80), ('GoSend', 90), ('Grab Express', 100),
  ('Lainnya', 999)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD; resi text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  resi := btrim(COALESCE(_no_resi,''));
  IF resi = '' THEN RAISE EXCEPTION 'No Resi wajib diisi'; END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = resi LIMIT 1;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Resi % tidak ditemukan di data order', resi;
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil kurir pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'ready_pickup', auth.uid(), NULL);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $$;
