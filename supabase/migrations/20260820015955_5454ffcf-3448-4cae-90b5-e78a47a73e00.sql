create or replace function public.link_project_to_order(_project_id uuid, _order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  it record;
  nextpos int;
begin
  if not public.is_admin_or_owner(auth.uid()) then
    raise exception 'Forbidden: hanya admin/owner';
  end if;

  select * into p from public.projects where id = _project_id;
  if not found then raise exception 'Project tidak ditemukan'; end if;

  select * into it from public.order_items where project_id = _project_id order by created_at limit 1;

  if _order_id is null then
    if found then
      delete from public.order_items where id = it.id;
    else
      update public.projects set parent_order_id = null where id = _project_id;
    end if;
    return;
  end if;

  select coalesce(max(position),0) + 1 into nextpos from public.order_items where order_id = _order_id;

  if it.id is not null then
    if it.order_id = _order_id then
      update public.projects set parent_order_id = _order_id where id = _project_id;
      return;
    end if;
    update public.order_items set order_id = _order_id, position = nextpos where id = it.id;
  else
    insert into public.order_items(order_id, position, kind, project_id, text_neon, titik)
    values (_order_id, nextpos, 'custom', _project_id,
            coalesce(nullif(p.title,''), p.code), greatest(coalesce(p.total_points,0),0));
  end if;

  update public.projects set parent_order_id = _order_id where id = _project_id;
end;
$$;

grant execute on function public.link_project_to_order(uuid, uuid) to authenticated;