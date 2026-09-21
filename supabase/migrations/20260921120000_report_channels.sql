-- «Источники: Без источника — 5749 — 100.0%» — это не отчёт, это пустая строка
-- на месте отчёта. Причина в импорте: Amo отдаёт source_id = null у всех сделок,
-- справочник источников там не заполнялся вовсе.
--
-- Но канал в данных есть — он лежит в метках: fbform, tilda, «сообщение (paid)»,
-- звонок, tiktok, «сайт (заявка)», «знакомые/рекомендация», «с улицы». Метками
-- размечено 5.5 тысяч сделок из 5749. Это не выдуманная атрибуция, а та же самая,
-- которой отдел пользуется в Amo, просто прочитанная оттуда, где она лежит.
--
-- У сотни сделок меток канала несколько (tiktok + звонок: реклама привела, дошёл
-- звонком). Сделка считается один раз по приоритету: что привело, важнее чем чем
-- дошёл.

create or replace function public.crm_report_snapshot()
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  with visible as materialized (
    select d.id, d.status, d.stage_id, d.source_id, d.lost_reason_id
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
  channel_map (tag, label, priority) as (
    values
      ('сайт (заявка)',          'Сайт — заявка',        1),
      ('tilda',                  'Сайт (Tilda)',         2),
      ('fbform',                 'Facebook — лид-форма', 3),
      ('tiktok',                 'TikTok',               4),
      ('сообщение (paid)',       'Реклама — сообщение',  5),
      ('звонок',                 'Входящий звонок',      6),
      ('знакомые/рекомендация',  'Рекомендация',         7),
      ('с улицы',                'Пришёл сам',           8)
  ),
  deal_channel as (
    select distinct on (v.id) v.id, m.label
    from visible v
    join public.deal_tags dt on dt.deal_id = v.id
    join public.tags t on t.id = dt.tag_id
    join channel_map m on m.tag = t.name
    order by v.id, m.priority
  ),
  channel_counts as (
    select label as key, count(*)::bigint as value
    from deal_channel
    group by label
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
        as reason_counts,
      coalesce((select jsonb_object_agg(key, value) from channel_counts), '{}'::jsonb)
        as channel_counts
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
    'channel_counts', grouped.channel_counts,
    'channel_unknown', totals.total - (select count(*) from deal_channel),
    'source_without_value', totals.source_without_value,
    'reason_without_value', totals.reason_without_value
  )
  from totals
  cross join grouped;
$$;

revoke all on function public.crm_report_snapshot() from public;
grant execute on function public.crm_report_snapshot() to authenticated;

create index if not exists deal_tags_deal_idx on public.deal_tags (deal_id);
