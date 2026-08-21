CREATE OR REPLACE FUNCTION public.detach_projects_on_order_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.projects
    SET parent_order_id = NULL,
        status = CASE WHEN status = 'cancelled' THEN status ELSE 'active'::project_status END
  WHERE parent_order_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_detach_projects_on_order_delete ON public.orders;
CREATE TRIGGER trg_detach_projects_on_order_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.detach_projects_on_order_delete();

DROP FUNCTION IF EXISTS public.get_available_projects();
CREATE FUNCTION public.get_available_projects()
 RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric, parent_order_id uuid, order_no text, order_status text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH active_rates AS (
    SELECT id, COALESCE(pricing_mode,'per_unit') AS pricing_mode
    FROM public.job_rates WHERE active = true
  ), project_availability AS (
    SELECT
      p.id, p.code, p.title, p.status,
      COALESCE(SUM(CASE WHEN ar.pricing_mode = 'area' THEN 1 ELSE p.total_points END), 0)::integer AS total_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 1 ELSE 0 END
        ELSE LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)
      END), 0) AS claimed_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 0 ELSE 1 END
        ELSE GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)
      END), 0) AS remaining_points,
      p.parent_order_id, o.order_no, o.status AS order_status, p.created_at
    FROM public.projects p
    JOIN public.orders o ON o.id = p.parent_order_id
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty, COUNT(*) > 0 AS has_claim
      FROM public.job_logs jl
      WHERE jl.project_id = p.id AND jl.rate_id = ar.id
        AND jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.parent_order_id, o.order_no, o.status, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points, parent_order_id, order_no, order_status
  FROM project_availability
  ORDER BY created_at DESC;
$function$;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

UPDATE public.projects p SET parent_order_id = NULL
WHERE p.parent_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p.parent_order_id);