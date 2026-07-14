
ALTER TABLE public.job_rates
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'per_unit',
  ADD COLUMN IF NOT EXISTS min_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.job_rates
  DROP CONSTRAINT IF EXISTS job_rates_pricing_mode_check;
ALTER TABLE public.job_rates
  ADD CONSTRAINT job_rates_pricing_mode_check CHECK (pricing_mode IN ('per_unit','area'));

CREATE OR REPLACE FUNCTION public.calc_job_log_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r numeric; m numeric; mode text; base numeric;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit')
    INTO r, m, mode
    FROM public.job_rates WHERE id = NEW.rate_id;
  base := COALESCE(r,0) * NEW.qty;
  IF mode = 'area' THEN
    NEW.amount := GREATEST(base, m);
  ELSE
    IF m > 0 THEN
      NEW.amount := GREATEST(base, m);
    ELSE
      NEW.amount := base;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_project_point_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE total int; claimed numeric; mode text;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(pricing_mode,'per_unit') INTO mode FROM public.job_rates WHERE id = NEW.rate_id;
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
END $function$;
