-- Bounded trash listing for the authenticated trash UI.
-- SECURITY DEFINER is paired with explicit role/ownership filtering below.

create or replace function public.list_crm_trash(
  p_entity text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  role_name public.user_role := public.my_role();
  result jsonb;
begin
  if actor is null or role_name is null or role_name not in ('manager', 'head', 'admin') then
    raise exception using errcode = '42501', message = 'CRM trash access is not permitted';
  end if;

  if p_entity is not null and p_entity not in ('deals', 'contacts', 'notes', 'tasks') then
    raise exception using errcode = '22023', message = 'Unsupported CRM trash type';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid CRM trash pagination';
  end if;

  with trash as (
    select
      'deals'::text as entity,
      d.id,
      coalesce(nullif(btrim(d.title), ''), 'Сделка') as label,
      d.deleted_at,
      d.deleted_by,
      p.full_name as deleted_by_name
    from public.deals d
    left join public.profiles p on p.id = d.deleted_by
    where d.deleted_at is not null
      and (role_name in ('head', 'admin') or d.deleted_by = actor)
      and (p_entity is null or p_entity = 'deals')

    union all

    select
      'contacts'::text,
      c.id,
      coalesce(nullif(btrim(c.full_name), ''), 'Контакт'),
      c.deleted_at,
      c.deleted_by,
      p.full_name
    from public.contacts c
    left join public.profiles p on p.id = c.deleted_by
    where c.deleted_at is not null
      and (role_name in ('head', 'admin') or c.deleted_by = actor)
      and (p_entity is null or p_entity = 'contacts')

    union all

    select
      'notes'::text,
      n.id,
      'Примечание'::text,
      n.deleted_at,
      n.deleted_by,
      p.full_name
    from public.notes n
    left join public.profiles p on p.id = n.deleted_by
    where n.deleted_at is not null
      and (role_name in ('head', 'admin') or n.deleted_by = actor)
      and (p_entity is null or p_entity = 'notes')

    union all

    select
      'tasks'::text,
      t.id,
      coalesce(nullif(btrim(t.title), ''), 'Задача'),
      t.deleted_at,
      t.deleted_by,
      p.full_name
    from public.tasks t
    left join public.profiles p on p.id = t.deleted_by
    where t.deleted_at is not null
      and (role_name in ('head', 'admin') or t.deleted_by = actor)
      and (p_entity is null or p_entity = 'tasks')
  ),
  counted as (
    select count(*)::integer as total from trash
  ),
  paged as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entity', entity,
          'id', id,
          'label', label,
          'deleted_at', deleted_at,
          'deleted_by', deleted_by,
          'deleted_by_name', deleted_by_name
        )
        order by deleted_at desc, id
      ),
      '[]'::jsonb
    ) as rows
    from (
      select *
      from trash
      order by deleted_at desc, id
      limit p_limit offset p_offset
    ) page
  )
  select jsonb_build_object('total', counted.total, 'rows', paged.rows)
  into result
  from counted cross join paged;

  return result;
end;
$$;

revoke all on function public.list_crm_trash(text, integer, integer) from public;
grant execute on function public.list_crm_trash(text, integer, integer) to authenticated;
