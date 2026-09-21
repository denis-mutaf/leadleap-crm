-- Настройкам этапов нужен счётчик всех сделок, а не только активных.
--
-- Колонка «Сделок» в настройках брала stage_counts, где стоит фильтр
-- status in ('open','postponed') — он верен для отчёта по живой воронке, но в
-- настройках даёт ноль у «Договора» (62 сделки) и «Отказа» (1958). А рядом
-- висит предупреждение «Этап со сделками удалить нельзя», то есть считать надо
-- именно все. Добавлен отдельный ключ stage_totals; отчёт продолжает жить на
-- stage_counts.

create or replace function public.crm_report_snapshot()
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  with visible as materialized (
    select d.status, d.stage_id, d.source_id, d.lost_reason_id
    from public.deals d
    where auth.uid() is not null
      and public.my_role() in ('head', 'admin')
      and d.deleted_at is null
  ),
  totals as (
    select
      count(*)::bigint as total,
      count(*) filter (where status in ('open', 'postponed'))::bigint as open_count,
      count(*) filter (where status = 'won')::bigint as won,
      count(*) filter (where status = 'lost')::bigint as lost,
      count(*) filter (where source_id is null)::bigint
        as source_without_value,
      count(*) filter (where status = 'lost' and lost_reason_id is null)::bigint
        as reason_without_value
    from visible
  ),
  stage_counts as (
    select stage_id::text as key, count(*)::bigint as value
    from visible
    where status in ('open', 'postponed')
    group by stage_id
  ),
  stage_totals as (
    select stage_id::text as key, count(*)::bigint as value
    from visible
    group by stage_id
  ),
  source_counts as (
    select source_id::text as key, count(*)::bigint as value
    from visible
    where source_id is not null
    group by source_id
  ),
  reason_counts as (
    select lost_reason_id::text as key, count(*)::bigint as value
    from visible
    where status = 'lost' and lost_reason_id is not null
    group by lost_reason_id
  ),
  grouped as (
    select
      coalesce((select jsonb_object_agg(key, value) from stage_counts), '{}'::jsonb)
        as stage_counts,
      coalesce((select jsonb_object_agg(key, value) from stage_totals), '{}'::jsonb)
        as stage_totals,
      coalesce((select jsonb_object_agg(key, value) from source_counts), '{}'::jsonb)
        as source_counts,
      coalesce((select jsonb_object_agg(key, value) from reason_counts), '{}'::jsonb)
        as reason_counts
  )
  select jsonb_build_object(
    'total', totals.total,
    'open', totals.open_count,
    'won', totals.won,
    'lost', totals.lost,
    'stage_counts', grouped.stage_counts,
    'stage_totals', grouped.stage_totals,
    'source_counts', grouped.source_counts,
    'reason_counts', grouped.reason_counts,
    'source_without_value', totals.source_without_value,
    'reason_without_value', totals.reason_without_value
  )
  from totals
  cross join grouped;
$$;

revoke all on function public.crm_report_snapshot() from public;
grant execute on function public.crm_report_snapshot() to authenticated;
