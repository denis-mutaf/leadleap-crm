-- Тикет 55, приёмка: когорты падали по statement_timeout под authenticated (10 с, лимит 8 с).
--
-- Причина: агрегат deal_projects (dp) читался внутри вложенного цикла по сделкам — 5 875 раз
-- по 253 строки, и на каждую строку RLS deal_projects делает проверку по deals
-- (1,5 млн обращений к deals_pkey). Под postgres RLS нет, поэтому там было быстро.
-- Исправление: dp материализуется один раз (as materialized) в обеих функциях, а у когорт
-- добавлено то же `set enable_nestloop = off`, что у crm_report_period; reach тоже материализован.
-- Замеры под `set local role authenticated` с claim QA-админа — в отчёте задачи.
--
-- Тела функций те же, что в 20261006230000_reports_period.sql; меняются только строки выше.
-- Права (grant/revoke) create or replace сохраняет.

create or replace function public.crm_report_period(
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  p_source text default null,
  p_manager text default null,
  p_project text default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
-- Планировщик не знает размера материализованных CTE (оценка «1 строка») и самосоединение
-- ent × ent строит вложенным циклом: на окне «с начала года» это 4 с вместо 0,15 с.
-- Без вложенных циклов (хеш-соединения) время не зависит от ширины периода.
set enable_nestloop = off
as $$
with
w as (
  select
    (p_from::timestamp at time zone 'Europe/Chisinau') as t0,
    ((p_to + 1)::timestamp at time zone 'Europe/Chisinau') as t1,
    (p_prev_from::timestamp at time zone 'Europe/Chisinau') as pt0,
    ((p_prev_to + 1)::timestamp at time zone 'Europe/Chisinau') as pt1
),
stg as materialized (
  select s.id, s.name, s.position, s.kind,
         (s.import_key in ('amo:stage:60', 'amo:stage:70')) as is_meeting,
         (s.import_key = 'amo:stage:90') as is_reserve
  from public.stages s
  where s.kind in ('open', 'won')
),
first_stage as (
  select s.id from stg s where s.kind = 'open' order by s.position limit 1
),
dp as materialized (
  select x.deal_id, array_agg(x.project_id) as ids
  from public.deal_projects x
  group by x.deal_id
),
dl as materialized (
  select d.id, d.contact_id, d.source_id, d.owner_id, d.status, d.amount,
         d.created_at, d.closed_at, d.lost_reason_id,
         coalesce(dp.ids, '{}'::uuid[]) as projects
  from public.deals d
  left join dp on dp.deal_id = d.id
  where (select auth.uid()) is not null
    and (select public.my_role()) in ('manager', 'head', 'admin')
    and d.deleted_at is null
    and (p_source is null
         or (p_source = 'none' and d.source_id is null)
         or d.source_id::text = p_source)
    and (p_manager is null
         or (p_manager = 'none' and d.owner_id is null)
         or d.owner_id::text = p_manager)
    and (p_project is null
         or (p_project = 'none' and dp.deal_id is null)
         or p_project = any (dp.ids::text[]))
),
-- переходы окон сначала отбираются по времени (индекс), и только потом связываются со сделками
tr as materialized (
  select st.deal_id, st.to_stage_id, st.changed_at
  from public.stage_transitions st
  cross join w
  where st.from_stage_id is distinct from st.to_stage_id
    and ((st.changed_at >= w.t0 and st.changed_at < w.t1)
         or (st.changed_at >= w.pt0 and st.changed_at < w.pt1))
),
-- задачи сделок читаются один раз (RLS на tasks дорогой): открытые и выполненные
tk as materialized (
  select t.deal_id, t.assignee_id, t.due_at, t.done_at
  from public.tasks t
  where t.deleted_at is null and t.deal_id is not null
),
-- первый вход сделки в этап внутри окна: 'c' — текущий период, 'p' — прошлый
ent as materialized (
  select x.deal_id, x.stage_id, x.win, min(x.t) as t
  from (
    select tr.deal_id, tr.to_stage_id as stage_id, tr.changed_at as t,
           case when tr.changed_at >= w.t0 and tr.changed_at < w.t1 then 'c' else 'p' end as win
    from tr
    join dl on dl.id = tr.deal_id
    cross join w
    union all
    select dl.id, (select fs.id from first_stage fs), dl.created_at,
           case when dl.created_at >= w.t0 and dl.created_at < w.t1 then 'c' else 'p' end
    from dl
    cross join w
    where (dl.created_at >= w.t0 and dl.created_at < w.t1)
       or (dl.created_at >= w.pt0 and dl.created_at < w.pt1)
  ) x
  where x.stage_id is not null
  group by x.deal_id, x.stage_id, x.win
),
-- отвеченный звонок: длительность разговора больше нуля (так и у Amo-заметок, и у АТС)
ac as materialized (
  select c.deal_id, c.contact_id,
         case when c.started_at >= w.t0 and c.started_at < w.t1 then 'c' else 'p' end as win
  from public.calls c
  cross join w
  where coalesce(c.duration_sec, 0) > 0
    and ((c.started_at >= w.t0 and c.started_at < w.t1)
         or (c.started_at >= w.pt0 and c.started_at < w.pt1))
),
-- сделка «дозвонилась», если отвеченный звонок привязан к сделке или к её контакту
ans as materialized (
  select dl.id as deal_id, ac.win
  from ac join dl on dl.id = ac.deal_id
  union
  select dl.id, ac.win
  from ac join dl on dl.contact_id = ac.contact_id
),
dm as materialized (
  select d.id, d.contact_id, d.source_id, d.owner_id, d.projects, d.status, d.amount, d.created_at,
         (d.created_at >= w.t0 and d.created_at < w.t1) as created,
         (d.created_at >= w.pt0 and d.created_at < w.pt1) as created_p,
         exists (select 1 from ent e join stg s on s.id = e.stage_id and s.is_meeting
                 where e.deal_id = d.id and e.win = 'c') as met,
         exists (select 1 from ent e join stg s on s.id = e.stage_id and s.is_meeting
                 where e.deal_id = d.id and e.win = 'p') as met_p,
         exists (select 1 from ent e join stg s on s.id = e.stage_id and s.is_reserve
                 where e.deal_id = d.id and e.win = 'c') as resv,
         exists (select 1 from ent e join stg s on s.id = e.stage_id and s.is_reserve
                 where e.deal_id = d.id and e.win = 'p') as resv_p,
         exists (select 1 from ans a where a.deal_id = d.id and a.win = 'c') as answered,
         exists (select 1 from ans a where a.deal_id = d.id and a.win = 'p') as answered_p
  from dl d
  cross join w
  where (d.created_at >= w.t0 and d.created_at < w.t1)
     or (d.created_at >= w.pt0 and d.created_at < w.pt1)
     or d.id in (select e.deal_id from ent e)
),
agg as (
  select
    count(*) filter (where created) as new_c,
    count(*) filter (where created_p) as new_p,
    count(*) filter (where created and answered) as ans_c,
    count(*) filter (where created_p and answered_p) as ans_p,
    count(*) filter (where met) as met_c,
    count(*) filter (where met_p) as met_p,
    count(*) filter (where resv) as resv_c,
    count(*) filter (where resv_p) as resv_p,
    coalesce(sum(amount) filter (where resv), 0) as resv_sum_c,
    count(amount) filter (where resv) as resv_known_c,
    coalesce(sum(amount) filter (where resv_p), 0) as resv_sum_p
  from dm
),
-- конверсия: из вошедших в этап A доля тех, кто позже в том же периоде вошёл в этап B (позиция B > A)
conv as materialized (
  select a.stage_id as sa, b.stage_id as sb, count(*) as n
  from ent a
  join stg x on x.id = a.stage_id
  join ent b on b.deal_id = a.deal_id and b.win = 'c' and b.t > a.t
  join stg y on y.id = b.stage_id and y.position > x.position
  where a.win = 'c'
  group by a.stage_id, b.stage_id
),
entered as materialized (
  select e.stage_id, count(*) as n from ent e where e.win = 'c' group by e.stage_id
),
-- первое действие менеджера по сделке периода: исходящий звонок, исходящее сообщение или выполненная задача
fa as materialized (
  select u.deal_id, min(u.t) as t
  from (
    select d.id as deal_id, c.started_at as t
    from dm d join public.calls c on c.deal_id = d.id and c.direction = 'out' and c.started_at >= d.created_at
    where d.created
    union all
    select d.id, c.started_at
    from dm d join public.calls c on c.contact_id = d.contact_id and c.direction = 'out' and c.started_at >= d.created_at
    where d.created
    union all
    select d.id, m.sent_at
    from dm d
    join public.conversations cv on cv.contact_id = d.contact_id
    join public.messages m on m.conversation_id = cv.id and m.direction = 'out' and m.sent_at >= d.created_at
    where d.created
    union all
    select d.id, tk.done_at
    from dm d
    join tk on tk.deal_id = d.id and tk.done_at is not null and tk.done_at >= d.created_at
    where d.created
  ) u
  group by u.deal_id
),
segv as (
  select 'source'::text as dim, coalesce(source_id::text, 'none') as k, created, answered, met, resv from dm
  union all
  select 'manager', coalesce(owner_id::text, 'none'), created, answered, met, resv from dm
  union all
  select 'project', pk, created, answered, met, resv
  from dm
  cross join lateral unnest(
    case when cardinality(projects) = 0 then array['none'] else projects::text[] end
  ) as pk
),
seg as materialized (
  select dim, k,
         count(*) filter (where created) as obr,
         count(*) filter (where created and answered) as answered,
         count(*) filter (where met) as met,
         count(*) filter (where resv) as resv,
         count(*) filter (where created and resv) as conv
  from segv
  group by dim, k
),
mgr_fa as (
  select coalesce(d.owner_id::text, 'none') as k,
         count(*) filter (where fa.t is not null) as measured,
         (percentile_cont(0.5) within group (order by extract(epoch from (fa.t - d.created_at)) / 60.0)
            filter (where fa.t is not null)) as median_min
  from dm d
  left join fa on fa.deal_id = d.id
  where d.created
  group by 1
),
ov as (
  select coalesce(tk.assignee_id::text, 'none') as k, count(*) as n
  from tk
  join dl on dl.id = tk.deal_id
  where tk.done_at is null and tk.due_at < now()
  group by 1
),
nonext as (
  select coalesce(d.owner_id::text, 'none') as k, count(*) as n
  from dl d
  where d.status in ('open', 'postponed')
    and not exists (
      select 1 from tk where tk.deal_id = d.id and tk.done_at is null
    )
  group by 1
),
mgr_keys as (
  select k from (
    select k from seg where dim = 'manager'
    union select k from ov
    union select k from nonext
  ) u
  where p_manager is null or u.k = p_manager
),
reasons as (
  select coalesce(d.lost_reason_id::text, 'none') as k, count(*) as n
  from dl d
  cross join w
  where d.status = 'lost' and d.closed_at >= w.t0 and d.closed_at < w.t1
  group by 1
)
select jsonb_build_object(
  'generated_at', now(),
  'widgets', (
    select jsonb_build_object(
      'new', jsonb_build_object('cur', new_c, 'prev', new_p),
      'answered', jsonb_build_object('cur', ans_c, 'prev', ans_p, 'of_cur', new_c, 'of_prev', new_p),
      'meetings', jsonb_build_object('cur', met_c, 'prev', met_p),
      'reservations', jsonb_build_object(
        'cur', resv_c, 'prev', resv_p,
        'sum_cur', resv_sum_c, 'sum_prev', resv_sum_p, 'known_cur', resv_known_c)
    ) from agg
  ),
  'stages', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'position', s.position, 'kind', s.kind,
      'entered', coalesce(en.n, 0),
      'reached', coalesce((select jsonb_object_agg(c.sb::text, c.n) from conv c where c.sa = s.id), '{}'::jsonb)
    ) order by s.position), '[]'::jsonb)
    from stg s
    left join entered en on en.stage_id = s.id
  ),
  'sources', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', g.k, 'name', so.name, 'obr', g.obr, 'answered', g.answered,
      'met', g.met, 'resv', g.resv, 'conv', g.conv
    ) order by g.obr desc, g.resv desc), '[]'::jsonb)
    from seg g
    left join public.sources so on so.id::text = g.k
    where g.dim = 'source' and g.obr + g.met + g.resv > 0
  ),
  'projects', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', g.k, 'name', pr.name, 'obr', g.obr, 'answered', g.answered,
      'met', g.met, 'resv', g.resv, 'conv', g.conv
    ) order by g.obr desc, g.resv desc), '[]'::jsonb)
    from seg g
    left join public.projects pr on pr.id::text = g.k
    where g.dim = 'project' and g.obr + g.met + g.resv > 0
  ),
  'managers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', mk.k, 'name', pf.full_name,
      'obr', coalesce(g.obr, 0), 'met', coalesce(g.met, 0), 'resv', coalesce(g.resv, 0),
      'measured', coalesce(mf.measured, 0), 'median_min', round(mf.median_min::numeric, 1),
      'overdue', coalesce(ov.n, 0), 'no_next', coalesce(nn.n, 0)
    ) order by coalesce(g.obr, 0) desc, pf.full_name), '[]'::jsonb)
    from mgr_keys mk
    left join seg g on g.dim = 'manager' and g.k = mk.k
    left join mgr_fa mf on mf.k = mk.k
    left join ov on ov.k = mk.k
    left join nonext nn on nn.k = mk.k
    left join public.profiles pf on pf.id::text = mk.k
  ),
  'reasons', (
    select coalesce(jsonb_agg(jsonb_build_object('key', r.k, 'name', lr.name, 'n', r.n) order by r.n desc), '[]'::jsonb)
    from reasons r
    left join public.lost_reasons lr on lr.id::text = r.k
  )
);
$$;

create or replace function public.crm_report_cohorts(
  p_source text default null,
  p_manager text default null,
  p_project text default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
-- См. комментарий у crm_report_period: без вложенных циклов план не зависит от ошибочных
-- оценок размера материализованных CTE.
set enable_nestloop = off
as $$
with
stg as materialized (
  select s.id, s.position, s.kind, (s.import_key = 'amo:stage:90') as is_reserve
  from public.stages s
  where s.kind in ('open', 'won')
),
rp as (
  select s.position from stg s where s.is_reserve limit 1
),
dp as materialized (
  select x.deal_id, array_agg(x.project_id) as ids
  from public.deal_projects x
  group by x.deal_id
),
dl as materialized (
  select d.id, d.stage_id, d.created_at
  from public.deals d
  left join dp on dp.deal_id = d.id
  where (select auth.uid()) is not null
    and (select public.my_role()) in ('manager', 'head', 'admin')
    and d.deleted_at is null
    and (p_source is null
         or (p_source = 'none' and d.source_id is null)
         or d.source_id::text = p_source)
    and (p_manager is null
         or (p_manager = 'none' and d.owner_id is null)
         or d.owner_id::text = p_manager)
    and (p_project is null
         or (p_project = 'none' and dp.deal_id is null)
         or p_project = any (dp.ids::text[]))
),
reach as materialized (
  select st.deal_id, min(st.changed_at) as t
  from public.stage_transitions st
  join dl on dl.id = st.deal_id
  join stg s on s.id = st.to_stage_id
  cross join rp
  where st.from_stage_id is distinct from st.to_stage_id
    and s.position >= rp.position
  group by st.deal_id
),
cd as (
  select date_trunc('month', d.created_at at time zone 'Europe/Chisinau') as m,
         d.created_at,
         r.t,
         (r.t is null and cs.position >= rp.position) as fb
  from dl d
  left join reach r on r.deal_id = d.id
  left join stg cs on cs.id = d.stage_id
  cross join rp
),
nowl as (
  select (now() at time zone 'Europe/Chisinau') as n
)
select coalesce(jsonb_agg(jsonb_build_object(
  'month', to_char(g.m, 'YYYY-MM'),
  'n', g.n,
  'r3', g.r3, 'r6', g.r6, 'r12', g.r12,
  'fallback', g.fb
) order by g.m desc), '[]'::jsonb)
from (
  select cd.m,
         count(*) as n,
         count(*) filter (where cd.fb) as fb,
         case when cd.m + interval '4 months' <= (select n from nowl)
              then count(*) filter (where cd.fb or (cd.t is not null and cd.t <= cd.created_at + interval '3 months')) end as r3,
         case when cd.m + interval '7 months' <= (select n from nowl)
              then count(*) filter (where cd.fb or (cd.t is not null and cd.t <= cd.created_at + interval '6 months')) end as r6,
         case when cd.m + interval '13 months' <= (select n from nowl)
              then count(*) filter (where cd.fb or (cd.t is not null and cd.t <= cd.created_at + interval '12 months')) end as r12
  from cd
  group by cd.m
) g;
$$;
