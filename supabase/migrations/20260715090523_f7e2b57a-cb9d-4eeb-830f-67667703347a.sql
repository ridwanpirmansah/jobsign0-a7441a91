
DROP FUNCTION IF EXISTS public.get_active_pipeline();

CREATE OR REPLACE FUNCTION public.get_active_pipeline()
 RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_kabel THEN 'packing'
      WHEN has_tempel THEN 'kabel'
      WHEN has_solder THEN 'tempel'
      WHEN has_potong THEN 'solder'
      WHEN has_cut THEN 'potong'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY
    CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
    deadline ASC,
    co_date DESC NULLS LAST,
    project_code DESC;
$function$;

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
      'notes', o.notes
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
