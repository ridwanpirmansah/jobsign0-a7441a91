
-- Remove auto-close on pickup
CREATE OR REPLACE FUNCTION public.mark_ready_pickup(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

-- Scheduled closer: close projects for orders whose ready_pickup_at is >= 48h ago
CREATE OR REPLACE FUNCTION public.close_projects_after_pickup_delay()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT o.project_id FROM public.orders o
          WHERE o.ready_pickup_at IS NOT NULL
            AND o.ready_pickup_at <= now() - interval '48 hours'
            AND o.project_id IS NOT NULL
        UNION
        SELECT oi.project_id FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          WHERE o.ready_pickup_at IS NOT NULL
            AND o.ready_pickup_at <= now() - interval '48 hours'
            AND oi.project_id IS NOT NULL
      );
END $function$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-projects-after-pickup-delay') THEN
    PERFORM cron.unschedule('close-projects-after-pickup-delay');
  END IF;
END $$;

SELECT cron.schedule(
  'close-projects-after-pickup-delay',
  '0 * * * *',
  $$ SELECT public.close_projects_after_pickup_delay(); $$
);
