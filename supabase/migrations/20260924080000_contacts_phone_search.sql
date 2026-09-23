-- Поиск контактов по телефону в любом виде (аудит 23.09.2026).
-- Было: «069111875» и «69 111 875» давали ноль — телефон сравнивался с запросом
-- как есть, а в базе он хранится +37369111875. Стало: если запрос похож на номер,
-- он приводится crm_phone_digits к цифрам базы и ищется и в импортированных номерах.

CREATE OR REPLACE FUNCTION public.list_contacts_page(p_page integer DEFAULT 0, p_page_size integer DEFAULT 50, p_query text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text)
 RETURNS TABLE(id uuid, full_name text, created_at timestamp with time zone, phone text, deal_count bigint, last_activity_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
        -- Номер в любом виде: 069 111 875, (069)111-875, +373 69… — по цифрам.
        or (
          p_query ~ '^[0-9[:space:]+()-]+$'
          and length(public.crm_phone_digits(p_query)) >= 4
          and (
            exists (
              select 1 from contact_phones cp
              where cp.contact_id = c.id
                and cp.phone like '%' || public.crm_phone_digits(p_query) || '%'
            )
            or exists (
              select 1 from imported_contact_phones ip
              where ip.contact_id = c.id
                and ip.normalized_phone like '%' || public.crm_phone_digits(p_query) || '%'
            )
          )
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
$function$;
