DROP FUNCTION IF EXISTS public.get_available_projects();
CREATE OR REPLACE FUNCTION public.get_available_projects()
 RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric, parent_order_id uuid, order_no text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id, COALESCE(pricing_mode,'per_unit') AS pricing_mode
    FROM public.job_rates
    WHERE active = true
  ), project_availability AS (
    SELECT
      p.id,
      p.code,
      p.title,
      p.status,
      COALESCE(SUM(CASE WHEN ar.pricing_mode = 'area' THEN 1 ELSE p.total_points END), 0)::integer AS total_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 1 ELSE 0 END
        ELSE LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)
      END), 0) AS claimed_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 0 ELSE 1 END
        ELSE GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)
      END), 0) AS remaining_points,
      p.parent_order_id,
      o.order_no,
      p.created_at
    FROM public.projects p
    LEFT JOIN public.orders o ON o.id = p.parent_order_id
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty, COUNT(*) > 0 AS has_claim
      FROM public.job_logs jl
      WHERE jl.project_id = p.id
        AND jl.rate_id = ar.id
        AND jl.status <> 'rejected'
        AND COALESCE(jl.is_repair,false) = false
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.parent_order_id, o.order_no, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points, parent_order_id, order_no
  FROM project_availability
  ORDER BY created_at DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;