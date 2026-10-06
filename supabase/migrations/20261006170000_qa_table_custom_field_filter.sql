-- QA тикет 54: пользовательские поля доступны в фильтрах таблицы сделок.
-- Новые параметры p_cf (поле) и p_cfv (значение) идут последними с default null:
-- клиент до выкладки продолжает работать. Тело — из прода (pg_get_functiondef)
-- с двумя точечными вставками. Старую сигнатуру нужно убрать, иначе PostgREST
-- не выберет между двумя перегрузками.
-- Доска (crm_board) переписывается в миграции 20261006200000 (инженер F): тот же
-- фильтр для неё добавить туда — см. отчёт инженера D.

drop function if exists public.crm_deals_table(text, uuid, uuid, text, text, text, integer, integer);

CREATE FUNCTION public.crm_deals_table(p_q text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid, p_stage uuid DEFAULT NULL::uuid, p_flag text DEFAULT NULL::text, p_sort text DEFAULT 'activity'::text, p_dir text DEFAULT 'desc'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50,
  p_cf uuid DEFAULT NULL::uuid, p_cfv text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q      text := nullif(btrim(coalesce(p_q, '')), '');
  cf_like text := '%' || replace(replace(replace(coalesce(p_cfv, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  like_q text;
  digits text;
  asc_   boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  if q is not null then
    like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    digits := public.crm_phone_digits(q);
    if length(digits) < 4 then digits := null; end if;
  end if;

  return query
  with base as materialized (
    select d.id, d.contact_id, d.owner_id, d.stage_id, d.created_at, d.updated_at
    from deals d
    where d.deleted_at is null
      and (p_owner is null or d.owner_id = p_owner)
      and (p_stage is null or d.stage_id = p_stage)
      -- Пользовательское поле: текст — по вхождению, остальные типы — точное значение.
      and (p_cf is null or nullif(btrim(coalesce(p_cfv, '')), '') is null or exists (
            select 1
            from custom_field_values v
            join custom_field_defs f on f.id = v.field_id
            where v.entity_id = d.id and v.field_id = p_cf and f.entity = 'deal'
              and case when f.field_type = 'text'
                       then (v.value #>> '{}') ilike cf_like
                       else (v.value #>> '{}') = p_cfv end))
      and (
        p_flag is null
        or (p_flag = 'no_next_step' and d.status = 'open' and not exists (
              select 1 from tasks t where t.deal_id = d.id and t.done_at is null and t.deleted_at is null))
        or (p_flag = 'overdue' and exists (
              select 1 from tasks t
              where t.deal_id = d.id and t.done_at is null and t.deleted_at is null and t.due_at < now()))
        or (p_flag = 'today' and exists (
              select 1 from tasks t
              where t.deal_id = d.id and t.done_at is null and t.deleted_at is null
                and t.due_at >= date_trunc('day', now())
                and t.due_at <  date_trunc('day', now()) + interval '1 day'))
      )
      and (
        q is null
        or d.title ilike like_q
        or d.object_text ilike like_q
        or exists (select 1 from contacts c where c.id = d.contact_id and c.full_name ilike like_q)
        or (digits is not null and exists (
              select 1 from contact_phones cp
              where cp.contact_id = d.contact_id and cp.phone like '%' || digits || '%'))
      )
  ),
  keyed as (
    select
      b.id,
      b.created_at,
      b.updated_at,
      case p_sort
        when 'contact' then lower(c.full_name)
        when 'owner'   then lower(p.full_name)
        when 'tags'    then (select lower(min(tg.name)) from deal_tags dt join tags tg on tg.id = dt.tag_id where dt.deal_id = b.id)
      end as k_text,
      case p_sort
        when 'stage' then s.position::numeric
      end as k_num,
      case p_sort
        when 'task' then (select min(t.due_at) from tasks t where t.deal_id = b.id and t.done_at is null and t.deleted_at is null)
        when 'created' then b.created_at
        else b.updated_at
      end as k_time
    from base b
    left join contacts c on c.id = b.contact_id
    left join profiles p on p.id = b.owner_id
    left join stages s on s.id = b.stage_id
  )
  select k.id, count(*) over () as total
  from keyed k
  order by
    case when asc_ then k.k_text end asc nulls last,
    case when not asc_ then k.k_text end desc nulls last,
    case when asc_ then k.k_num end asc nulls last,
    case when not asc_ then k.k_num end desc nulls last,
    case when asc_ then k.k_time end asc nulls last,
    case when not asc_ then k.k_time end desc nulls last,
    k.id
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 200);
end;
$function$;


grant execute on function public.crm_deals_table(text, uuid, uuid, text, text, text, integer, integer, uuid, text) to authenticated;
