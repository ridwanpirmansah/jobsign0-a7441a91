
CREATE OR REPLACE FUNCTION public.close_projects_for_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT project_id FROM public.orders WHERE id = _order_id AND project_id IS NOT NULL
        UNION
        SELECT project_id FROM public.order_items WHERE order_id = _order_id AND project_id IS NOT NULL
      );
END $$;

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
  PERFORM public.close_projects_for_order(_order_id);
END $$;

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
  PERFORM public.close_projects_for_order(ord.id);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $$;
