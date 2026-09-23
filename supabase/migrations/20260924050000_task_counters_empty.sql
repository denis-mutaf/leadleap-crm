-- «Показано 0 из 1» на пустом списке задач (аудит 23.09.2026).
-- Счётчики собирались как bounds LEFT JOIN visible ON true и считали count(*):
-- при пустой выборке оставалась одна строка из NULL, и total/open показывали 1.
-- Теперь считаем по колонке one, которая есть только у настоящих задач.

create or replace function public.crm_task_counters(
  p_assignee uuid default null,
  p_type uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_query text default null
)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with visible as materialized (
    select 1 as one, t.due_at, t.done_at
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
    'total', count(v.one),
    'open', count(v.one) filter (where v.done_at is null),
    'overdue', count(v.one) filter (where v.done_at is null and v.due_at < b.day_start),
    'today', count(v.one) filter (
      where v.done_at is null
        and v.due_at >= b.day_start
        and v.due_at < b.day_start + interval '1 day'),
    'tomorrow', count(v.one) filter (
      where v.done_at is null
        and v.due_at >= b.day_start + interval '1 day'
        and v.due_at < b.day_start + interval '2 days')
  )
  from bounds b
  left join visible v on true
  group by b.day_start;
$function$;
