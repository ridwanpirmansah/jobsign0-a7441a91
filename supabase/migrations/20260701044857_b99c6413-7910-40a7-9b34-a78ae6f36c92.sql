
CREATE OR REPLACE FUNCTION public.assign_order_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE max_no int; max_rs int; is_rs boolean;
BEGIN
  IF NEW.status = 'draft' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' THEN
      NEW.order_no := '0';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'ready_stock' THEN
    -- Auto-assign RS-N when empty, '0', or plain integer (previous behavior)
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_rs
        FROM public.orders
        WHERE status = 'ready_stock'
          AND order_no ~ '^RS-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'RS-' || (max_rs + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  -- active/return
  is_rs := NEW.order_no ~* '^RS-';
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR is_rs THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE status NOT IN ('draft','ready_stock')
        AND order_no !~* '^RS-'
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $function$;
