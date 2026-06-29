
CREATE OR REPLACE FUNCTION public.assign_order_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE max_no int;
BEGIN
  -- Normalize empty/null for draft & ready_stock => '0'
  IF NEW.status IN ('draft','ready_stock') THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' THEN
      NEW.order_no := '0';
    END IF;
    RETURN NEW;
  END IF;

  -- For active/return: if order_no kosong atau '0', assign nomor urut berikutnya
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE status NOT IN ('draft','ready_stock')
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_order_no ON public.orders;
CREATE TRIGGER trg_assign_order_no
  BEFORE INSERT OR UPDATE OF status, order_no ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_order_no();
