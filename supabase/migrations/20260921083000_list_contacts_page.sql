-- Экран контактов собирал список, счётчики и активность отдельными запросами
-- и открывался несколько секунд. Одна функция отдаёт страницу целиком.
-- Внешние ключи в Postgres не индексируются сами; без этих индексов
-- агрегаты по контакту читают таблицы целиком.
create index if not exists notes_contact_id_idx on public.notes (contact_id);
create index if not exists calls_contact_id_idx on public.calls (contact_id);
create index if not exists deals_contact_id_idx on public.deals (contact_id);
create index if not exists contact_phones_contact_id_idx on public.contact_phones (contact_id);

create or replace function public.list_contacts_page(
  p_page int default 0,
  p_page_size int default 50,
  p_query text default null,
  p_sort text default 'name'
)
returns table (
  id uuid,
  full_name text,
  created_at timestamptz,
  phone text,
  deal_count bigint,
  last_activity_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with visible as (
    select c.id, c.full_name, c.created_at, c.last_activity_at,
      count(*) over () as total_count
    from contacts c
    where c.deleted_at is null
      and c.merged_into is null
      and (
        p_query is null
        or c.full_name ilike '%' || p_query || '%'
        or exists (
          select 1 from contact_phones cp
          where cp.contact_id = c.id
            and cp.phone ilike '%' || p_query || '%'
        )
      )
    order by
      case when p_sort = 'created'  then c.created_at end desc nulls last,
      case when p_sort = 'activity' then c.last_activity_at end desc nulls last,
      case when p_sort not in ('created', 'activity') then c.full_name end asc nulls last,
      c.id
    offset greatest(p_page, 0) * greatest(p_page_size, 1)
    limit greatest(p_page_size, 1)
  )
  -- Телефон и число сделок читаются только для полусотни строк страницы.
  select v.id, v.full_name, v.created_at,
    (select cp.phone from contact_phones cp
      where cp.contact_id = v.id
      order by cp.is_primary desc nulls last, cp.created_at
      limit 1) as phone,
    (select count(*) from deals d
      where d.contact_id = v.id and d.deleted_at is null) as deal_count,
    v.last_activity_at, v.total_count
  from visible v
  order by
    case when p_sort = 'created'  then v.created_at end desc nulls last,
    case when p_sort = 'activity' then v.last_activity_at end desc nulls last,
    case when p_sort not in ('created', 'activity') then v.full_name end asc nulls last,
    v.id;
$$;

grant execute on function public.list_contacts_page(int, int, text, text) to authenticated;
