
-- 1) Tambah kolom reparasi di job_logs
ALTER TABLE public.job_logs
  ADD COLUMN IF NOT EXISTS is_repair boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repair_reason text,
  ADD COLUMN IF NOT EXISTS source_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_logs_source_order_idx ON public.job_logs(source_order_id) WHERE is_repair = true;

-- 2) Tambah repair_cost ke orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS repair_cost numeric NOT NULL DEFAULT 0;

-- 3) Skip enforce_project_point_limit untuk reparasi
CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE total int; claimed numeric;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
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
END $function$;

-- 4) Sertakan repair_cost dalam HPP order
CREATE OR REPLACE FUNCTION public.calc_order_costs()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0) + COALESCE(NEW.repair_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

-- 5) Trigger: agregasi repair_cost per order dari approved repair logs
CREATE OR REPLACE FUNCTION public.recalc_order_repair_cost()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE oid uuid; total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    oid := OLD.source_order_id;
  ELSE
    oid := NEW.source_order_id;
  END IF;
  IF oid IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.source_order_id IS NOT NULL AND OLD.source_order_id IS DISTINCT FROM NEW.source_order_id THEN
      SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
        WHERE source_order_id = OLD.source_order_id AND is_repair = true AND status = 'approved';
      UPDATE public.orders SET repair_cost = total WHERE id = OLD.source_order_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
    WHERE source_order_id = oid AND is_repair = true AND status = 'approved';
  UPDATE public.orders SET repair_cost = total WHERE id = oid;
  -- juga update order lama jika source_order_id berubah
  IF TG_OP = 'UPDATE' AND OLD.source_order_id IS NOT NULL AND OLD.source_order_id IS DISTINCT FROM NEW.source_order_id THEN
    SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
      WHERE source_order_id = OLD.source_order_id AND is_repair = true AND status = 'approved';
    UPDATE public.orders SET repair_cost = total WHERE id = OLD.source_order_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS trg_joblogs_repair_cost ON public.job_logs;
CREATE TRIGGER trg_joblogs_repair_cost
AFTER INSERT OR UPDATE OF status, amount, source_order_id, is_repair OR DELETE
ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.recalc_order_repair_cost();

-- 6) RPC approve_job_log: full / partial / reject + optional amount override
CREATE OR REPLACE FUNCTION public.approve_job_log(
  _id uuid,
  _status text,
  _qty numeric DEFAULT NULL,
  _amount numeric DEFAULT NULL
) RETURNS public.job_logs
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE row public.job_logs;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  IF _status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  -- Update qty dulu (trigger calc_job_log_amount akan hitung amount = qty * rate)
  IF _qty IS NOT NULL THEN
    IF _qty <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;
    UPDATE public.job_logs SET qty = _qty WHERE id = _id;
  END IF;

  -- Override amount jika diberikan
  IF _amount IS NOT NULL THEN
    IF _amount < 0 THEN RAISE EXCEPTION 'Nominal tidak boleh negatif'; END IF;
    UPDATE public.job_logs SET amount = _amount WHERE id = _id;
  END IF;

  UPDATE public.job_logs
     SET status = _status::job_log_status,
         approved_by = auth.uid(),
         approved_at = now()
   WHERE id = _id
   RETURNING * INTO row;

  RETURN row;
END $function$;

REVOKE EXECUTE ON FUNCTION public.approve_job_log(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_job_log(uuid, text, numeric, numeric) TO authenticated;

-- 7) Daftar order yang bisa direparasi (active/return)
CREATE OR REPLACE FUNCTION public.get_repairable_orders()
 RETURNS TABLE(id uuid, order_no text, text_neon text, username text, kota text, status text, project_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT id, order_no, text_neon, username, kota, status, project_id
  FROM public.orders
  WHERE status IN ('active','return','ready_stock')
  ORDER BY created_at DESC
  LIMIT 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_repairable_orders() TO authenticated;

-- 8) Recalc existing orders untuk memastikan repair_cost=0 ter-include
UPDATE public.orders SET updated_at = now() WHERE repair_cost = 0;
