CREATE OR REPLACE FUNCTION public.assign_order_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE max_no int; max_rs int; max_dr int; is_rs boolean; is_dr boolean;
BEGIN
  IF NEW.status = 'draft' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR NOT (NEW.order_no ~* '^DR-\d+$') THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_dr
        FROM public.orders
        WHERE order_no ~ '^DR-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'DR-' || (max_dr + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'ready_stock' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_rs
        FROM public.orders
        WHERE order_no ~ '^RS-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'RS-' || (max_rs + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  -- active/return
  is_rs := NEW.order_no ~* '^RS-';
  is_dr := NEW.order_no ~* '^DR-';
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR is_rs OR is_dr THEN
    -- Cari nomor terbesar dari SEMUA order bernomor angka (tanpa memandang status),
    -- supaya tidak bentrok dengan ready stock/draft yang memakai nomor angka biasa.
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE order_no !~* '^RS-'
        AND order_no !~* '^DR-'
        AND order_no !~ '-D\d+$'
        AND order_no ~ '^\d+$'
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $$;