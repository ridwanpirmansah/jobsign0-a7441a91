
-- 1) Fix duplicate project
CREATE OR REPLACE FUNCTION public.sync_item_to_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid; proj_code text;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
  header_proj_id uuid; header_has_logs boolean;
BEGIN
  IF NEW.kind <> 'custom' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO header_proj_id
    FROM public.projects
    WHERE parent_order_id = ord.id
      AND code = ord.order_no
    LIMIT 1;
  IF header_proj_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = header_proj_id) INTO header_has_logs;
    IF NOT header_has_logs THEN
      IF ord.project_id = header_proj_id THEN
        UPDATE public.orders SET project_id = NULL WHERE id = ord.id;
      END IF;
      DELETE FROM public.projects WHERE id = header_proj_id;
    END IF;
  END IF;

  proj_code := COALESCE(NULLIF(ord.order_no,''),'ORD') || '-' || NEW.position::text;
  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET code = proj_code,
          title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id)
      VALUES (proj_code,
              COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
              cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects
        SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            customer_id = cust_id,
            total_points = GREATEST(NEW.titik,0),
            contract_value = contract_val,
            parent_order_id = ord.id
        WHERE id = proj_id;
    END IF;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 1b) Cleanup existing duplicates
DELETE FROM public.projects p
WHERE p.parent_order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = p.parent_order_id AND o.order_no = p.code
  )
  AND EXISTS (
    SELECT 1 FROM public.projects p2
     WHERE p2.parent_order_id = p.parent_order_id
       AND p2.id <> p.id
       AND p2.code LIKE p.code || '-%'
  )
  AND NOT EXISTS (SELECT 1 FROM public.job_logs jl WHERE jl.project_id = p.id);

-- 2) Shipment columns on orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS no_resi text,
  ADD COLUMN IF NOT EXISTS ekspedisi text,
  ADD COLUMN IF NOT EXISTS ready_pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_no_resi_idx ON public.orders (no_resi);
CREATE INDEX IF NOT EXISTS orders_ready_pickup_idx ON public.orders (ready_pickup_at) WHERE picked_up_at IS NULL;

-- 3) shipment_events table
CREATE TABLE IF NOT EXISTS public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('ready_pickup','picked_up')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.shipment_events TO authenticated;
GRANT ALL ON public.shipment_events TO service_role;

ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view all shipment_events" ON public.shipment_events;
CREATE POLICY "Staff can view all shipment_events"
  ON public.shipment_events FOR SELECT TO authenticated
  USING (public.is_admin_or_owner(auth.uid()) OR public.has_role(auth.uid(),'kurir') OR actor_id = auth.uid());

DROP POLICY IF EXISTS "Staff or actor can insert shipment_events" ON public.shipment_events;
CREATE POLICY "Staff or actor can insert shipment_events"
  ON public.shipment_events FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_owner(auth.uid()) OR actor_id = auth.uid());

-- 4) Orders policy for kurir
DROP POLICY IF EXISTS "Kurir can view pickup-ready orders" ON public.orders;
CREATE POLICY "Kurir can view pickup-ready orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'kurir') AND (
      (ready_pickup_at IS NOT NULL AND picked_up_at IS NULL)
      OR picked_up_by = auth.uid()
    )
  );

-- 5) Functions
CREATE OR REPLACE FUNCTION public.mark_ready_pickup(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF COALESCE(ord.no_resi,'') = '' THEN RAISE EXCEPTION 'No Resi belum diisi'; END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()),
        updated_at = now()
    WHERE id = _order_id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (_order_id, 'ready_pickup', auth.uid(), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.courier_pickup(_no_resi text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(),'kurir') AND NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya kurir';
  END IF;
  IF _no_resi IS NULL OR btrim(_no_resi) = '' THEN
    RAISE EXCEPTION 'No Resi wajib diisi';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = btrim(_no_resi) LIMIT 1;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Resi tidak ditemukan'; END IF;
  IF ord.ready_pickup_at IS NULL THEN
    RAISE EXCEPTION 'Paket belum ditandai siap pickup oleh admin';
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET picked_up_at = now(), picked_up_by = auth.uid(), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'picked_up', auth.uid(), _note);
  RETURN jsonb_build_object('order_id', ord.id, 'order_no', ord.order_no, 'ekspedisi', ord.ekspedisi);
END $$;
