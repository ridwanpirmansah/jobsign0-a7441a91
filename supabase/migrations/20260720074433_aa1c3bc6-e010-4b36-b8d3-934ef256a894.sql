
-- 1) Add deadline & packing_kayu to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deadline date,
  ADD COLUMN IF NOT EXISTS packing_kayu boolean NOT NULL DEFAULT false;

-- 2) Propagate deadline to project via sync_order_to_project
CREATE OR REPLACE FUNCTION public.sync_order_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cust_id uuid; cust_name text; proj_id uuid; proj_code text; has_logs boolean; item_count int;
BEGIN
  SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  IF item_count > 0 THEN
    RETURN NEW;  -- managed by sync_item_to_project
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN DELETE FROM public.projects WHERE id = proj_id; END IF;
    END IF;
    RETURN NEW;
  END IF;

  proj_code := NEW.order_no;
  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET code = proj_code, title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
      deadline = NEW.deadline
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (proj_code, NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active', NEW.id, NEW.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
        deadline = NEW.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 3) sync_item_to_project also propagate deadline
CREATE OR REPLACE FUNCTION public.sync_item_to_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid; proj_code text;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
  header_proj_id uuid; header_has_logs boolean;
BEGIN
  IF NEW.kind <> 'custom' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO header_proj_id
    FROM public.projects
    WHERE parent_order_id = ord.id
      AND code = ord.order_no
    LIMIT 1;
  IF header_proj_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = header_proj_id) INTO header_has_logs;
    IF NOT header_has_logs THEN
      IF ord.project_id = header_proj_id THEN
        UPDATE public.orders SET project_id = NULL WHERE id = ord.id;
      END IF;
      DELETE FROM public.projects WHERE id = header_proj_id;
    END IF;
  END IF;

  proj_code := COALESCE(NULLIF(ord.order_no,''),'ORD') || '-' || NEW.position::text;
  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET code = proj_code,
          title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id,
          deadline = ord.deadline
      WHERE id = NEW.project_id;
    proj_id := NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE code = proj_code LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (proj_code,
              COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
              cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id, ord.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects
        SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            customer_id = cust_id,
            total_points = GREATEST(NEW.titik,0),
            contract_value = contract_val,
            parent_order_id = ord.id,
            deadline = ord.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

-- 4) get_active_pipeline: add packing_kayu & use_outdoor flags
DROP FUNCTION IF EXISTS public.get_active_pipeline();
CREATE OR REPLACE FUNCTION public.get_active_pipeline()
 RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, packing_kayu boolean, use_outdoor boolean, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
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
  order_outdoor AS (
    SELECT o.id AS order_id,
      COALESCE(BOOL_OR(COALESCE(o.outdoor_cost,0) > 0), false)
        OR COALESCE(BOOL_OR(COALESCE(oi.outdoor_cost,0) > 0), false) AS use_outdoor
    FROM public.orders o
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
    GROUP BY o.id
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(o.packing_kayu, false) AS packing_kayu,
      COALESCE(oo.use_outdoor, false) AS use_outdoor,
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
    LEFT JOIN order_outdoor oo ON oo.order_id = o.id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
      AND (o.id IS NULL OR o.status::text NOT IN ('ready_stock','draft'))
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at, o.packing_kayu, oo.use_outdoor
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    packing_kayu, use_outdoor,
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

-- 5) get_project_detail_for_worker: include packing_kayu + outdoor_cost
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
      'packing_kayu', COALESCE(o.packing_kayu,false),
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
