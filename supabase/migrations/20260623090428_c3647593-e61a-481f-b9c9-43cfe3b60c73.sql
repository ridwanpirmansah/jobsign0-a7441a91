CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(
  id uuid,
  code text,
  title text,
  status project_status,
  total_points integer,
  claimed_points numeric,
  remaining_points numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id
    FROM public.job_rates
    WHERE active = true
  ), project_availability AS (
    SELECT
      p.id,
      p.code,
      p.title,
      p.status,
      (p.total_points * COUNT(ar.id))::integer AS total_points,
      COALESCE(SUM(LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)), 0) AS claimed_points,
      COALESCE(SUM(GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)), 0) AS remaining_points,
      p.created_at
    FROM public.projects p
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty
      FROM public.job_logs jl
      WHERE jl.project_id = p.id
        AND jl.rate_id = ar.id
        AND jl.status <> 'rejected'
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.total_points, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points
  FROM project_availability
  ORDER BY created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;