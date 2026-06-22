
-- Update trigger: enforce limit per (project_id, rate_id)
CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  total int;
  claimed numeric;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND rate_id = NEW.rate_id
      AND status <> 'rejected'
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END; $function$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_enforce_project_point_limit ON public.job_logs;
CREATE TRIGGER trg_enforce_project_point_limit
  BEFORE INSERT OR UPDATE ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_point_limit();

-- New function: per-rate availability for a project
CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
RETURNS TABLE(rate_id uuid, rate_name text, unit text, rate_per_unit numeric, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    r.id AS rate_id,
    r.name AS rate_name,
    r.unit,
    r.rate_per_unit,
    p.total_points,
    COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl
              WHERE jl.project_id = p.id AND jl.rate_id = r.id AND jl.status <> 'rejected'), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl
              WHERE jl.project_id = p.id AND jl.rate_id = r.id AND jl.status <> 'rejected'), 0), 0) AS remaining_points
  FROM public.projects p
  CROSS JOIN public.job_rates r
  WHERE p.id = _project_id AND r.active = true
  ORDER BY r.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) TO authenticated;
