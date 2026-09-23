-- Таблица сделок: порядок и поиск считает база, а не PostgREST.
--
-- Было (аудит 23.09.2026): сортировка «Этап» и «Ответственный» шла по uuid
-- (stage_id, owner_id) — порядок выглядел случайным; поиск смотрел только
-- title и object_text, поэтому имя контакта из первой колонки не находилось,
-- а телефон не искался вовсе; ?flag=overdue таблица игнорировала.
--
-- Стало: crm_deals_table отдаёт id страницы в нужном порядке и общее число.
-- Этап — по позиции в воронке, ответственный и контакт — по имени,
-- метки — по первой метке, задача — по ближайшему сроку открытой задачи.
-- Поиск: название, объект, имя контакта, телефон (0XX… и пробелы нормализуются
-- к +373…). Флаги те же, что у crm_board. SECURITY INVOKER — RLS действует.

create or replace function public.crm_phone_digits(p_raw text)
returns text
language sql
immutable
parallel safe
as $$
  -- Цифры номера в формате базы без «+»: 069123456 → 37369123456.
  select case
    when d ~ '^0[0-9]{8}$' then '373' || substr(d, 2)
    when d ~ '^00' then substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d) s;
$$;

create or replace function public.crm_deals_table(
  p_q      text    default null,
  p_owner  uuid    default null,
  p_stage  uuid    default null,
  p_flag   text    default null,
  p_sort   text    default 'activity',
  p_dir    text    default 'desc',
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (id uuid, total bigint)
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  q      text := nullif(btrim(coalesce(p_q, '')), '');
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
$$;

grant execute on function public.crm_phone_digits(text) to authenticated;
grant execute on function public.crm_deals_table(text, uuid, uuid, text, text, text, integer, integer) to authenticated;
