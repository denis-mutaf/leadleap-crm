-- Экран задач ходил в базу пять раз только за числами в шапке: всего,
-- просрочено, сегодня, завтра, открытых. Сами счётчики по 1707 строкам
-- считаются за миллисекунды, а каждый поход стоит 130 мс дороги, и клиент
-- Supabase их сериализует — выходило больше секунды на пустом месте.
-- Одна функция отдаёт все пять сразу под теми же фильтрами.

create or replace function public.crm_task_counters(
  p_assignee uuid default null,
  p_type uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_query text default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  with visible as materialized (
    select t.due_at, t.done_at
    from public.tasks t
    where (p_assignee is null or t.assignee_id = p_assignee)
      and (p_type is null or t.type_id = p_type)
      and (p_from is null or t.due_at >= p_from)
      and (p_to is null or t.due_at < p_to)
      and (p_query is null or t.title ilike '%' || p_query || '%')
  ),
  bounds as (
    select
      date_trunc('day', now() at time zone 'Europe/Chisinau') at time zone 'Europe/Chisinau' as day_start
  )
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where v.done_at is null),
    'overdue', count(*) filter (where v.done_at is null and v.due_at < b.day_start),
    'today', count(*) filter (
      where v.done_at is null
        and v.due_at >= b.day_start
        and v.due_at < b.day_start + interval '1 day'),
    'tomorrow', count(*) filter (
      where v.done_at is null
        and v.due_at >= b.day_start + interval '1 day'
        and v.due_at < b.day_start + interval '2 days')
  )
  from bounds b
  left join visible v on true
  group by b.day_start;
$$;

revoke all on function public.crm_task_counters(uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.crm_task_counters(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
