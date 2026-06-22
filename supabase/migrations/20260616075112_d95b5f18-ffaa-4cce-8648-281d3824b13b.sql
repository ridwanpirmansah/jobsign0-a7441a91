
CREATE OR REPLACE FUNCTION public.get_available_projects()
RETURNS TABLE(id uuid, code text, title text, status project_status, total_points integer, claimed_points numeric, remaining_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.code, p.title, p.status, p.total_points,
    COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl WHERE jl.project_id = p.id AND jl.status <> 'rejected'), 0) AS claimed_points,
    GREATEST(p.total_points - COALESCE((SELECT SUM(jl.qty) FROM public.job_logs jl WHERE jl.project_id = p.id AND jl.status <> 'rejected'), 0), 0) AS remaining_points
  FROM public.projects p
  WHERE p.status IN ('draft','active')
  ORDER BY p.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  total int;
  claimed numeric;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO claimed
    FROM public.job_logs
    WHERE project_id = NEW.project_id
      AND status <> 'rejected'
      AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_project_point_limit ON public.job_logs;
CREATE TRIGGER trg_enforce_project_point_limit
  BEFORE INSERT OR UPDATE OF qty, project_id, status ON public.job_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_point_limit();
