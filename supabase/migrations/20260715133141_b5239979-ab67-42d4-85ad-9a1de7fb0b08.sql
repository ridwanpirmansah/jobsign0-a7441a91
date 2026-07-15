ALTER TABLE public.job_rates
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r numeric;
  m numeric;
  mode text;
  base numeric;
  area_qty numeric;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit')
    INTO r, m, mode
    FROM public.job_rates
    WHERE id = NEW.rate_id;

  IF mode = 'area' AND NEW.project_id IS NOT NULL AND COALESCE(NEW.is_repair, false) = false THEN
    SELECT COALESCE(NULLIF(o.akrilik_p, 0), NULLIF(oi.akrilik_p, 0), 0)
         * COALESCE(NULLIF(o.akrilik_l, 0), NULLIF(oi.akrilik_l, 0), 0)
      INTO area_qty
      FROM public.projects p
      LEFT JOIN public.orders o ON o.id = p.parent_order_id
      LEFT JOIN LATERAL (
        SELECT akrilik_p, akrilik_l
        FROM public.order_items
        WHERE order_id = p.parent_order_id
          AND COALESCE(akrilik_p, 0) > 0
          AND COALESCE(akrilik_l, 0) > 0
        ORDER BY position NULLS LAST, created_at ASC
        LIMIT 1
      ) oi ON true
      WHERE p.id = NEW.project_id;

    IF area_qty IS NULL OR area_qty <= 0 THEN
      RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
    END IF;

    NEW.qty := area_qty;
  END IF;

  base := COALESCE(r,0) * COALESCE(NEW.qty,0);
  NEW.amount := CASE WHEN m > 0 THEN GREATEST(base, m) ELSE base END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  total int;
  claimed numeric;
  mode text;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit') INTO mode
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode = 'area' THEN RETURN NEW; END IF;

  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(qty), 0) INTO claimed
  FROM public.job_logs
  WHERE project_id = NEW.project_id
    AND rate_id = NEW.rate_id
    AND status <> 'rejected'
    AND COALESCE(is_repair,false) = false
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_single_area_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  mode text;
  existing_emp uuid;
  existing_name text;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit') INTO mode
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode <> 'area' THEN RETURN NEW; END IF;

  SELECT jl.employee_id INTO existing_emp
  FROM public.job_logs jl
  WHERE jl.project_id = NEW.project_id
    AND jl.rate_id = NEW.rate_id
    AND jl.status <> 'rejected'
    AND COALESCE(jl.is_repair,false) = false
    AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
  LIMIT 1;

  IF existing_emp IS NOT NULL THEN
    SELECT full_name INTO existing_name FROM public.employees WHERE id = existing_emp;
    RAISE EXCEPTION 'Jenis garapan ini sudah diklaim oleh % pada project ini. Hanya 1 karyawan yang boleh mengklaim.', COALESCE(existing_name, 'karyawan lain');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_single_area_claim ON public.job_logs;
CREATE TRIGGER trg_enforce_single_area_claim
BEFORE INSERT OR UPDATE ON public.job_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_area_claim();

CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
RETURNS TABLE(
  rate_id uuid,
  rate_name text,
  unit text,
  rate_per_unit numeric,
  total_points integer,
  claimed_points numeric,
  remaining_points numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    r.id,
    r.name,
    r.unit,
    r.rate_per_unit,
    CASE WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN 1 ELSE p.total_points END AS total_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
      ELSE COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0)
    END AS claimed_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
      ELSE GREATEST(p.total_points - COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0), 0)
    END AS remaining_points
  FROM public.projects p
  CROSS JOIN public.job_rates r
  WHERE p.id = _project_id
    AND r.active = true
  ORDER BY r.sort_order ASC, r.name ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_project_rate_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_rate_availability(uuid) TO authenticated;

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
      p.created_at
    FROM public.projects p
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
    GROUP BY p.id, p.code, p.title, p.status, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points
  FROM project_availability
  ORDER BY created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_available_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_projects() TO authenticated;