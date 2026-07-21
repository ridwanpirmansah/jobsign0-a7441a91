
-- Fix get_project_detail_for_worker: compute use_outdoor (column doesn't exist)
CREATE OR REPLACE FUNCTION public.get_project_detail_for_worker(_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', o.akrilik_p, 'akrilik_l', o.akrilik_l,
      'led_meter', o.led_meter, 'titik', o.titik,
      'kabel_meter', o.kabel_meter,
      'kabel_socket_meter', o.kabel_socket_meter,
      'notes', o.notes,
      'deadline', o.deadline,
      'packing_kayu', COALESCE(o.packing_kayu, false),
      'use_outdoor', (
        COALESCE(o.outdoor_cost,0) > 0
        OR EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND COALESCE(oi.outdoor_cost,0) > 0)
      )
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  WHERE p.id = _project_id;
  RETURN result;
END $function$;

-- Auto-close projects 48 hours after courier pickup (picked_up_at), not ready_pickup_at.
-- Ready-stock projects are excluded from active pipeline via order status and remain untouched here.
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
          WHERE o.picked_up_at IS NOT NULL
            AND o.picked_up_at <= now() - interval '48 hours'
            AND o.project_id IS NOT NULL
            AND o.status::text NOT IN ('ready_stock','draft')
        UNION
        SELECT oi.project_id FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          WHERE o.picked_up_at IS NOT NULL
            AND o.picked_up_at <= now() - interval '48 hours'
            AND oi.project_id IS NOT NULL
            AND o.status::text NOT IN ('ready_stock','draft')
      );
END $function$;

-- Lookup any order by resi/no order (all statuses) for the Status page scanner
CREATE OR REPLACE FUNCTION public.lookup_order_by_resi(_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ord RECORD; q text;
BEGIN
  q := btrim(COALESCE(_query,''));
  IF q = '' THEN RETURN NULL; END IF;
  SELECT o.*, p.id AS proj_id
    INTO ord
    FROM public.orders o
    LEFT JOIN public.projects p ON p.parent_order_id = o.id
    WHERE o.no_resi = q OR lower(o.no_resi) = lower(q) OR lower(o.order_no) = lower(q)
    ORDER BY o.created_at DESC
    LIMIT 1;
  IF ord.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'order_id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'no_resi', ord.no_resi,
    'ekspedisi', ord.ekspedisi,
    'text_neon', ord.text_neon,
    'username', ord.username,
    'kota', ord.kota,
    'co_date', ord.co_date,
    'ready_pickup_at', ord.ready_pickup_at,
    'picked_up_at', ord.picked_up_at,
    'project_id', ord.proj_id
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.lookup_order_by_resi(text) TO authenticated;
