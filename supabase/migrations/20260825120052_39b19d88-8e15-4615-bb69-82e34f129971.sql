CREATE OR REPLACE FUNCTION public.get_order_history(_limit int DEFAULT 500)
RETURNS TABLE(
  order_id uuid,
  order_no text,
  no_resi text,
  ekspedisi text,
  username text,
  kota text,
  text_neon text,
  co_date date,
  ready_pickup_at timestamptz,
  picked_up_at timestamptz,
  order_status text,
  projects jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_no,
    o.no_resi,
    o.ekspedisi,
    o.username,
    o.kota,
    o.text_neon,
    o.co_date,
    o.ready_pickup_at,
    o.picked_up_at,
    o.status,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', p.id, 'code', p.code, 'title', p.title, 'status', p.status)
        ORDER BY p.code
      )
      FROM public.projects p
      WHERE p.parent_order_id = o.id
    ), '[]'::jsonb) AS projects
  FROM public.orders o
  WHERE o.picked_up_at IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.projects p2
       WHERE p2.parent_order_id = o.id AND p2.status = 'done'
     )
  ORDER BY COALESCE(o.picked_up_at, o.updated_at) DESC
  LIMIT _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_order_history(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_order_history(int) TO authenticated;