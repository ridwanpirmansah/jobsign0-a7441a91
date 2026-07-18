
-- 1) Add area_scope to job_rates
ALTER TABLE public.job_rates
  ADD COLUMN IF NOT EXISTS area_scope text NOT NULL DEFAULT 'project'
  CHECK (area_scope IN ('project','order'));

-- 2) calc_job_log_amount: order-scope area sums all items on the parent order
CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r numeric;
  m numeric;
  mode text;
  scope text;
  base numeric;
  area_qty numeric;
  parent_oid uuid;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit'), COALESCE(area_scope,'project')
    INTO r, m, mode, scope
    FROM public.job_rates
    WHERE id = NEW.rate_id;

  IF mode = 'area' AND NEW.project_id IS NOT NULL AND COALESCE(NEW.is_repair, false) = false THEN
    IF scope = 'order' THEN
      SELECT p.parent_order_id INTO parent_oid FROM public.projects p WHERE p.id = NEW.project_id;
      IF parent_oid IS NULL THEN
        RAISE EXCEPTION 'Project belum terhubung ke order, tidak bisa menghitung total area order.';
      END IF;
      -- Sum area across all items with dimensions; fallback to order header
      SELECT COALESCE(SUM(COALESCE(NULLIF(oi.akrilik_p,0),0) * COALESCE(NULLIF(oi.akrilik_l,0),0)), 0)
        INTO area_qty
        FROM public.order_items oi
        WHERE oi.order_id = parent_oid;
      IF area_qty IS NULL OR area_qty <= 0 THEN
        SELECT COALESCE(o.akrilik_p,0) * COALESCE(o.akrilik_l,0) INTO area_qty
          FROM public.orders o WHERE o.id = parent_oid;
      END IF;
      IF area_qty IS NULL OR area_qty <= 0 THEN
        RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
      END IF;
      NEW.qty := area_qty;
    ELSE
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
  END IF;

  base := COALESCE(r,0) * COALESCE(NEW.qty,0);
  NEW.amount := CASE WHEN m > 0 THEN GREATEST(base, m) ELSE base END;
  RETURN NEW;
END;
$function$;

-- 3) enforce_single_area_claim: for order-scope, block if any project of same parent order has claim
CREATE OR REPLACE FUNCTION public.enforce_single_area_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  mode text;
  scope text;
  existing_emp uuid;
  existing_name text;
  parent_oid uuid;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit'), COALESCE(area_scope,'project')
    INTO mode, scope
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode <> 'area' THEN RETURN NEW; END IF;

  IF scope = 'order' THEN
    SELECT parent_order_id INTO parent_oid FROM public.projects WHERE id = NEW.project_id;
    IF parent_oid IS NOT NULL THEN
      SELECT jl.employee_id INTO existing_emp
      FROM public.job_logs jl
      JOIN public.projects p ON p.id = jl.project_id
      WHERE p.parent_order_id = parent_oid
        AND jl.rate_id = NEW.rate_id
        AND jl.status <> 'rejected'
        AND COALESCE(jl.is_repair,false) = false
        AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
      LIMIT 1;
    ELSE
      existing_emp := NULL;
    END IF;
  ELSE
    SELECT jl.employee_id INTO existing_emp
    FROM public.job_logs jl
    WHERE jl.project_id = NEW.project_id
      AND jl.rate_id = NEW.rate_id
      AND jl.status <> 'rejected'
      AND COALESCE(jl.is_repair,false) = false
      AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
    LIMIT 1;
  END IF;

  IF existing_emp IS NOT NULL THEN
    SELECT full_name INTO existing_name FROM public.employees WHERE id = existing_emp;
    RAISE EXCEPTION 'Jenis garapan ini sudah diklaim oleh % pada order ini. Hanya 1 karyawan yang boleh mengklaim.', COALESCE(existing_name, 'karyawan lain');
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) get_project_rate_availability: for order-scope area, availability is per parent order
CREATE OR REPLACE FUNCTION public.get_project_rate_availability(_project_id uuid)
 RETURNS TABLE(rate_id uuid, rate_name text, unit text, rate_per_unit numeric, total_points integer, claimed_points numeric, remaining_points numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH proj AS (
    SELECT id, total_points, parent_order_id FROM public.projects WHERE id = _project_id
  )
  SELECT
    r.id,
    r.name,
    r.unit,
    r.rate_per_unit,
    CASE WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN 1 ELSE p.total_points END AS total_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' AND COALESCE(r.area_scope,'project') = 'order' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          JOIN public.projects p2 ON p2.id = jl.project_id
          WHERE p2.parent_order_id = p.parent_order_id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
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
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' AND COALESCE(r.area_scope,'project') = 'order' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          JOIN public.projects p2 ON p2.id = jl.project_id
          WHERE p2.parent_order_id = p.parent_order_id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
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
  FROM proj p
  CROSS JOIN public.job_rates r
  WHERE r.active = true
  ORDER BY r.sort_order ASC, r.name ASC;
$function$;

-- 5) get_active_pipeline: exclude ready_stock orders
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
      AND (o.id IS NULL OR o.status::text NOT IN ('ready_stock','draft'))
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
