-- Смоук тикета 55 (QA C-5): отчёты за период и когорты.
-- Прогнать ПОСЛЕ применения 20261006230000_reports_period.sql. BEGIN…ROLLBACK, в базе
-- ничего не остаётся. Все данные — в окне марта 2030 и когорте мая 2019 под своими
-- источниками (SMOKE-55), поэтому живые сделки не мешают точным числам.
-- Ожидаемо: последняя строка 'OK: qa-55'.
begin;

-- 0. Функции на месте, клиентским ролям — только authenticated.
do $$
begin
  if not has_function_privilege('authenticated', 'public.crm_report_period(date,date,date,date,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_report_cohorts(text,text,text)', 'execute') then
    raise exception 'FAIL 0: authenticated не может звать функции отчётов';
  end if;
  if has_function_privilege('anon', 'public.crm_report_period(date,date,date,date,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.crm_report_cohorts(text,text,text)', 'execute') then
    raise exception 'FAIL 0: anon может звать функции отчётов';
  end if;
  if exists (
    select 1 from pg_proc
     where proname in ('crm_report_period', 'crm_report_cohorts') and prosecdef
  ) then raise exception 'FAIL 0: функция отчётов объявлена security definer, нужен invoker'; end if;
end $$;

-- ===================================================================================
-- Данные. Триггеры выключены на время вставки (нужны точные даты и свои переходы).
-- ===================================================================================
set local session_replication_role = replica;

do $$
declare
  s0 uuid; smeet uuid; sresv uuid; swon uuid; slost uuid;
  m1 uuid; rsn uuid; src uuid; src2 uuid; prj uuid;
  cA uuid; cB uuid; cC uuid; cD uuid; cE uuid; cF uuid; cG uuid;
  cH1 uuid; cH2 uuid; cH3 uuid; cH4 uuid; cH5 uuid;
  dA uuid; dB uuid; dC uuid; dD uuid; dE uuid; dF uuid; dG uuid;
  dH1 uuid; dH2 uuid; dH3 uuid; dH4 uuid; dH5 uuid;
begin
  select id into s0 from public.stages where kind = 'open' and is_active order by position limit 1;
  select id into smeet from public.stages where import_key = 'amo:stage:60';
  select id into sresv from public.stages where import_key = 'amo:stage:90';
  select id into swon from public.stages where kind = 'won' order by position limit 1;
  select id into slost from public.stages where kind = 'lost' order by position limit 1;
  if s0 is null or smeet is null or sresv is null or swon is null or slost is null then
    raise exception 'FAIL setup: нет этапов amo:stage:60 / amo:stage:90 / договора / отказа';
  end if;
  select id into m1 from public.profiles where role = 'manager' and is_active order by id limit 1;
  select id into rsn from public.lost_reasons order by position limit 1;

  insert into public.sources (code, name) values ('smoke55', 'SMOKE-55 источник') returning id into src;
  insert into public.sources (code, name) values ('smoke55b', 'SMOKE-55 когорты') returning id into src2;
  insert into public.projects (code, name) values ('smoke55', 'SMOKE-55 проект') returning id into prj;

  insert into public.contacts (full_name) values ('SMOKE-55 A') returning id into cA;
  insert into public.contacts (full_name) values ('SMOKE-55 B') returning id into cB;
  insert into public.contacts (full_name) values ('SMOKE-55 C') returning id into cC;
  insert into public.contacts (full_name) values ('SMOKE-55 D') returning id into cD;
  insert into public.contacts (full_name) values ('SMOKE-55 E') returning id into cE;
  insert into public.contacts (full_name) values ('SMOKE-55 F') returning id into cF;
  insert into public.contacts (full_name) values ('SMOKE-55 G') returning id into cG;
  insert into public.contacts (full_name) values ('SMOKE-55 H1') returning id into cH1;
  insert into public.contacts (full_name) values ('SMOKE-55 H2') returning id into cH2;
  insert into public.contacts (full_name) values ('SMOKE-55 H3') returning id into cH3;
  insert into public.contacts (full_name) values ('SMOKE-55 H4') returning id into cH4;
  insert into public.contacts (full_name) values ('SMOKE-55 H5') returning id into cH5;

  -- Окно: 01–31.03.2030 (Europe/Chisinau), прошлый период: 01–28.02.2030.
  -- A: создана в окне, встреча 12.03, резервация 20.03 (€ 100 000); есть шумовой переход s0→s0.
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, amount, title)
  values (cA, sresv, 'open', src, m1, timestamptz '2030-03-10 10:00+00', 100000, 'SMOKE-55 A') returning id into dA;
  -- B: создана в окне, встреча 16.03.
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cB, smeet, 'open', src, m1, timestamptz '2030-03-15 10:00+00', 'SMOKE-55 B') returning id into dB;
  -- C: без источника и без менеджера.
  insert into public.deals (contact_id, stage_id, status, created_at, title)
  values (cC, s0, 'open', timestamptz '2030-03-20 10:00+00', 'SMOKE-55 C') returning id into dC;
  -- D: создана в прошлом периоде (10.02), встреча 15.02 (прошлый период), резервация 05.03 (текущий; € 50 000).
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, amount, title)
  values (cD, sresv, 'open', src, m1, timestamptz '2030-02-10 10:00+00', 50000, 'SMOKE-55 D') returning id into dD;
  -- E: создана 02.03, закрыта отказом 25.03 с причиной.
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, closed_at, lost_reason_id, title)
  values (cE, slost, 'lost', src, m1, timestamptz '2030-03-02 10:00+00', timestamptz '2030-03-25 12:00+00', rsn, 'SMOKE-55 E') returning id into dE;
  -- F: 31.03 22:30 UTC = 01.04 01:30 в Кишинёве — в март не попадает, попадает в апрель.
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cF, s0, 'open', src, m1, timestamptz '2030-03-31 22:30+00', 'SMOKE-55 F') returning id into dF;
  -- G: 28.02 22:30 UTC = 01.03 00:30 в Кишинёве — в март попадает.
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cG, s0, 'open', src, m1, timestamptz '2030-02-28 22:30+00', 'SMOKE-55 G') returning id into dG;

  insert into public.deal_projects (deal_id, project_id) values (dA, prj), (dD, prj);

  insert into public.stage_transitions (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_at)
  select v.d, v.f, v.t,
         (select kind::text::public.deal_status from public.stages where id = v.f),
         (select kind::text::public.deal_status from public.stages where id = v.t),
         v.at
  from (values
    (dA, null::uuid, s0, timestamptz '2030-03-10 10:00+00'),
    (dA, s0, s0, timestamptz '2030-03-10 10:01+00'),
    (dA, s0, smeet, timestamptz '2030-03-12 09:00+00'),
    (dA, smeet, sresv, timestamptz '2030-03-20 09:00+00'),
    (dB, null, s0, timestamptz '2030-03-15 10:00+00'),
    (dB, s0, smeet, timestamptz '2030-03-16 09:00+00'),
    (dC, null, s0, timestamptz '2030-03-20 10:00+00'),
    (dD, null, s0, timestamptz '2030-02-10 10:00+00'),
    (dD, s0, smeet, timestamptz '2030-02-15 09:00+00'),
    (dD, smeet, sresv, timestamptz '2030-03-05 09:00+00'),
    (dE, null, s0, timestamptz '2030-03-02 10:00+00'),
    (dE, s0, slost, timestamptz '2030-03-25 12:00+00'),
    (dF, null, s0, timestamptz '2030-03-31 22:30+00'),
    (dG, null, s0, timestamptz '2030-02-28 22:30+00')
  ) as v(d, f, t, at);

  -- Звонки: A отвечен по сделке, E — только по контакту, B — разговор 0 с, D — в прошлом периоде.
  -- Исходящие A (+30 мин) и B (+90 мин) дают медиану первого ответа 60 мин у менеджера m1.
  insert into public.calls (external_id, direction, contact_id, deal_id, user_id, started_at, duration_sec)
  values
    ('smoke55-a-in', 'in', cA, dA, m1, timestamptz '2030-03-11 10:00+00', 60),
    ('smoke55-e-in', 'in', cE, null, m1, timestamptz '2030-03-04 10:00+00', 45),
    ('smoke55-b-in', 'in', cB, dB, m1, timestamptz '2030-03-17 10:00+00', 0),
    ('smoke55-d-in', 'in', cD, dD, m1, timestamptz '2030-02-12 10:00+00', 30),
    ('smoke55-a-out', 'out', cA, dA, m1, timestamptz '2030-03-10 10:30+00', 0),
    ('smoke55-b-out', 'out', cB, dB, m1, timestamptz '2030-03-15 11:30+00', 0);

  -- Одна открытая просроченная задача по G (состояние на сейчас). У открытых A, B, D, F задач нет.
  insert into public.tasks (title, due_at, deal_id, assignee_id)
  values ('SMOKE-55 просрочена', now() - interval '1 day', dG, m1);

  -- Когорта мая 2019 (источник src2): H1 → резервация через 3 нед.; H2 → договор через 10 мес.;
  -- H3 без истории, сейчас на резервации; H4 без истории, на первом этапе; H5 — создана сейчас (незрелая).
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cH1, sresv, 'open', src2, m1, timestamptz '2019-05-10 10:00+00', 'SMOKE-55 H1') returning id into dH1;
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cH2, swon, 'won', src2, m1, timestamptz '2019-05-10 10:00+00', 'SMOKE-55 H2') returning id into dH2;
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cH3, sresv, 'open', src2, m1, timestamptz '2019-05-10 10:00+00', 'SMOKE-55 H3') returning id into dH3;
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cH4, s0, 'open', src2, m1, timestamptz '2019-05-10 10:00+00', 'SMOKE-55 H4') returning id into dH4;
  insert into public.deals (contact_id, stage_id, status, source_id, owner_id, created_at, title)
  values (cH5, s0, 'open', src2, m1, now(), 'SMOKE-55 H5') returning id into dH5;

  insert into public.stage_transitions (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_at)
  select v.d, v.f, v.t,
         (select kind::text::public.deal_status from public.stages where id = v.f),
         (select kind::text::public.deal_status from public.stages where id = v.t),
         v.at
  from (values
    (dH1, s0, sresv, timestamptz '2019-05-31 10:00+00'),
    (dH2, s0, swon, timestamptz '2020-03-10 10:00+00')
  ) as v(d, f, t, at);

  perform set_config('smoke55.src', src::text, true);
  perform set_config('smoke55.src2', src2::text, true);
  perform set_config('smoke55.prj', prj::text, true);
  perform set_config('smoke55.m1', m1::text, true);
  perform set_config('smoke55.rsn', rsn::text, true);
  perform set_config('smoke55.s0', s0::text, true);
  perform set_config('smoke55.smeet', smeet::text, true);
  perform set_config('smoke55.sresv', sresv::text, true);
  perform set_config('smoke55.swon', swon::text, true);
end $$;

set local session_replication_role = origin;

-- Другой менеджер (не ответственный по сделкам выше) и режим «менеджер видит своё».
select set_config('smoke55.m2', (
  select id::text from public.profiles
   where role = 'manager' and is_active and id <> current_setting('smoke55.m1')::uuid
   order by id limit 1
), true);

-- ===================================================================================
-- Руководитель: полные числа.
-- ===================================================================================
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles where role = 'head' and is_active order by id limit 1
), true);
set local role authenticated;

do $$
declare
  src text := current_setting('smoke55.src');
  src2 text := current_setting('smoke55.src2');
  prj text := current_setting('smoke55.prj');
  m1 text := current_setting('smoke55.m1');
  r jsonb; x jsonb; n int;
begin
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28', src, null, null);

  -- 1. Виджеты: создание по Кишинёвскому времени (G — в марте, F — в апреле), прошлый период.
  if (r #>> '{widgets,new,cur}')::int <> 4 then raise exception 'FAIL 1: новых за март %, ждали 4 (A, B, E, G)', r #>> '{widgets,new,cur}'; end if;
  if (r #>> '{widgets,new,prev}')::int <> 1 then raise exception 'FAIL 1: новых за февраль %, ждали 1 (D)', r #>> '{widgets,new,prev}'; end if;
  if (r #>> '{widgets,meetings,cur}')::int <> 2 or (r #>> '{widgets,meetings,prev}')::int <> 1 then
    raise exception 'FAIL 1: встречи %/%, ждали 2/1', r #>> '{widgets,meetings,cur}', r #>> '{widgets,meetings,prev}';
  end if;
  if (r #>> '{widgets,reservations,cur}')::int <> 2 or (r #>> '{widgets,reservations,prev}')::int <> 0 then
    raise exception 'FAIL 1: резервации %/%, ждали 2/0', r #>> '{widgets,reservations,cur}', r #>> '{widgets,reservations,prev}';
  end if;
  if (r #>> '{widgets,reservations,sum_cur}')::numeric <> 150000 or (r #>> '{widgets,reservations,known_cur}')::int <> 2 then
    raise exception 'FAIL 1: сумма резерваций %, ждали 150000 по 2 сделкам', r #>> '{widgets,reservations,sum_cur}';
  end if;
  -- дозвон: A (по сделке) и E (по контакту); B — разговор 0 с; в прошлом периоде D.
  if (r #>> '{widgets,answered,cur}')::int <> 2 or (r #>> '{widgets,answered,of_cur}')::int <> 4 then
    raise exception 'FAIL 1: дозвон %/%, ждали 2/4', r #>> '{widgets,answered,cur}', r #>> '{widgets,answered,of_cur}';
  end if;
  if (r #>> '{widgets,answered,prev}')::int <> 1 or (r #>> '{widgets,answered,of_prev}')::int <> 1 then
    raise exception 'FAIL 1: дозвон прошлого периода %/%, ждали 1/1', r #>> '{widgets,answered,prev}', r #>> '{widgets,answered,of_prev}';
  end if;

  -- 2. Границы суток: апрель видит F (01.04 01:30 по Кишинёву), март — не видит.
  if (public.crm_report_period(date '2030-04-01', date '2030-04-30', date '2030-03-01', date '2030-03-31', src, null, null)
        #>> '{widgets,new,cur}')::int <> 1 then
    raise exception 'FAIL 2: апрель не увидел сделку F на границе суток';
  end if;

  -- 3. Движение по воронке: вошли за март. Шумовой s0→s0 не считается, создание и s0-переход одной сделки — одна запись.
  select e into x from jsonb_array_elements(r -> 'stages') e where (e ->> 'id') = current_setting('smoke55.s0');
  if (x ->> 'entered')::int <> 4 then raise exception 'FAIL 3: в первый этап вошли %, ждали 4', x ->> 'entered'; end if;
  select e into x from jsonb_array_elements(r -> 'stages') e where (e ->> 'id') = current_setting('smoke55.smeet');
  if (x ->> 'entered')::int <> 2 then raise exception 'FAIL 3: во встречу вошли %, ждали 2 (A, B; D — в феврале)', x ->> 'entered'; end if;
  select e into x from jsonb_array_elements(r -> 'stages') e where (e ->> 'id') = current_setting('smoke55.sresv');
  if (x ->> 'entered')::int <> 2 then raise exception 'FAIL 3: в резервацию вошли %, ждали 2 (A, D)', x ->> 'entered'; end if;
  if exists (
    select 1 from jsonb_array_elements(r -> 'stages') e
     where (e ->> 'kind') not in ('open', 'won')
  ) then raise exception 'FAIL 3: в воронке есть этап отказа'; end if;

  -- 4. Конверсия: из 4 вошедших в первый этап 2 дошли до встречи (A, B) и 1 до резервации (A);
  -- из вошедших во встречу (A, B) до резервации — 1 (A).
  select e into x from jsonb_array_elements(r -> 'stages') e where (e ->> 'id') = current_setting('smoke55.s0');
  if coalesce((x #>> array['reached', current_setting('smoke55.smeet')])::int, 0) <> 2
     or coalesce((x #>> array['reached', current_setting('smoke55.sresv')])::int, 0) <> 1 then
    raise exception 'FAIL 4: конверсия из первого этапа %', x -> 'reached';
  end if;
  select e into x from jsonb_array_elements(r -> 'stages') e where (e ->> 'id') = current_setting('smoke55.smeet');
  if coalesce((x #>> array['reached', current_setting('smoke55.sresv')])::int, 0) <> 1 then
    raise exception 'FAIL 4: конверсия встреча → резервация %', x -> 'reached';
  end if;
  if coalesce((x #>> array['reached', current_setting('smoke55.smeet')])::int, 0) <> 0 then
    raise exception 'FAIL 4: этап «дошёл» сам до себя';
  end if;

  -- 5. Таблица источников: одна строка нашего источника.
  select e into x from jsonb_array_elements(r -> 'sources') e where (e ->> 'key') = src;
  if x is null
     or (x ->> 'obr')::int <> 4 or (x ->> 'answered')::int <> 2 or (x ->> 'met')::int <> 2
     or (x ->> 'resv')::int <> 2 or (x ->> 'conv')::int <> 1 then
    raise exception 'FAIL 5: строка источника %, ждали obr 4, answered 2, met 2, resv 2, conv 1', x;
  end if;
  if jsonb_array_length(r -> 'sources') <> 1 then raise exception 'FAIL 5: лишние строки источников: %', r -> 'sources'; end if;

  -- 6. Проекты: A, D — в проекте; B, E, G — «не указан».
  select e into x from jsonb_array_elements(r -> 'projects') e where (e ->> 'key') = prj;
  if x is null or (x ->> 'obr')::int <> 1 or (x ->> 'met')::int <> 1 or (x ->> 'resv')::int <> 2 or (x ->> 'conv')::int <> 1 then
    raise exception 'FAIL 6: строка проекта %', x;
  end if;
  select e into x from jsonb_array_elements(r -> 'projects') e where (e ->> 'key') = 'none';
  if x is null or (x ->> 'obr')::int <> 3 or (x ->> 'answered')::int <> 1 or (x ->> 'met')::int <> 1 then
    raise exception 'FAIL 6: строка «проект не указан» %', x;
  end if;

  -- 7. Менеджер: обращений 4, встреч 2, резерваций 2, медиана первого ответа 60 мин по 2 сделкам;
  -- просрочена 1 задача (G), без следующего шага — открытые A, B, D, F (E закрыта, у G задача есть).
  select e into x from jsonb_array_elements(r -> 'managers') e where (e ->> 'key') = m1;
  if x is null
     or (x ->> 'obr')::int <> 4 or (x ->> 'met')::int <> 2 or (x ->> 'resv')::int <> 2
     or (x ->> 'measured')::int <> 2 or (x ->> 'median_min')::numeric <> 60 then
    raise exception 'FAIL 7: строка менеджера %', x;
  end if;
  if (x ->> 'overdue')::int <> 1 or (x ->> 'no_next')::int <> 4 then
    raise exception 'FAIL 7: просрочено %, без шага %, ждали 1 и 4', x ->> 'overdue', x ->> 'no_next';
  end if;

  -- 8. Причины отказа: по дате закрытия (25.03), в феврале — пусто.
  if jsonb_array_length(r -> 'reasons') <> 1
     or (r #>> '{reasons,0,n}')::int <> 1
     or (r #>> '{reasons,0,key}') <> current_setting('smoke55.rsn') then
    raise exception 'FAIL 8: причины отказа за март %', r -> 'reasons';
  end if;
  if jsonb_array_length(public.crm_report_period(date '2030-02-01', date '2030-02-28', date '2030-01-01', date '2030-01-31', src, null, null) -> 'reasons') <> 0 then
    raise exception 'FAIL 8: отказ попал в февраль';
  end if;

  -- 9. Фильтры: «без источника» видит только C; менеджер m1 — свои 4; проект «не указан» — B, E, G.
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28', 'none', null, null);
  if (r #>> '{widgets,new,cur}')::int <> 1 then raise exception 'FAIL 9: без источника новых %, ждали 1 (C)', r #>> '{widgets,new,cur}'; end if;
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28', src, m1, null);
  if (r #>> '{widgets,new,cur}')::int <> 4 then raise exception 'FAIL 9: у менеджера m1 новых %, ждали 4', r #>> '{widgets,new,cur}'; end if;
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28', src, null, 'none');
  if (r #>> '{widgets,new,cur}')::int <> 3 then raise exception 'FAIL 9: без проекта новых %, ждали 3', r #>> '{widgets,new,cur}'; end if;
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28', src, null, prj);
  if (r #>> '{widgets,new,cur}')::int <> 1 then raise exception 'FAIL 9: в проекте новых %, ждали 1 (A)', r #>> '{widgets,new,cur}'; end if;

  -- 10. Когорты: май 2019 (источник src2) — 4 лида; за 3 мес. H1 и H3 (текущий этап), за 6 то же,
  -- за 12 ещё H2 (договор через 10 мес.); незрелая когорта (текущий месяц) — null; шумов нет.
  r := public.crm_report_cohorts(src2, null, null);
  select e into x from jsonb_array_elements(r) e where (e ->> 'month') = '2019-05';
  if x is null or (x ->> 'n')::int <> 4
     or (x ->> 'r3')::int <> 2 or (x ->> 'r6')::int <> 2 or (x ->> 'r12')::int <> 3
     or (x ->> 'fallback')::int <> 1 then
    raise exception 'FAIL 10: когорта 2019-05 %', x;
  end if;
  select e into x from jsonb_array_elements(r) e
   where (e ->> 'month') = to_char(now() at time zone 'Europe/Chisinau', 'YYYY-MM');
  if x is null or (x ->> 'n')::int <> 1 or x -> 'r3' <> 'null'::jsonb or x -> 'r6' <> 'null'::jsonb or x -> 'r12' <> 'null'::jsonb then
    raise exception 'FAIL 10: незрелая когорта должна быть пустой: %', x;
  end if;
  if jsonb_array_length(r) <> 2 then raise exception 'FAIL 10: лишние когорты: %', r; end if;
end $$;

reset role;

-- ===================================================================================
-- RLS: «менеджер видит своё» (manager_visibility ≠ all). Чужой менеджер сделок не видит,
-- ответственный — видит; застройщик не видит ничего.
-- ===================================================================================
update public.settings set value = '"own"'::jsonb where key = 'manager_visibility';

select set_config('request.jwt.claim.sub', current_setting('smoke55.m2'), true);
set local role authenticated;
do $$
declare r jsonb; c jsonb;
begin
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28',
                                current_setting('smoke55.src'), null, null);
  if (r #>> '{widgets,new,cur}')::int <> 0 or jsonb_array_length(r -> 'sources') <> 0 then
    raise exception 'FAIL 11: менеджер m2 видит чужие сделки: %', r -> 'widgets';
  end if;
  c := public.crm_report_cohorts(current_setting('smoke55.src2'), null, null);
  if jsonb_array_length(c) <> 0 then raise exception 'FAIL 11: менеджер m2 видит чужие когорты'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('smoke55.m1'), true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28',
                                current_setting('smoke55.src'), null, null);
  if (r #>> '{widgets,new,cur}')::int <> 4 then
    raise exception 'FAIL 12: ответственный m1 видит % новых, ждали 4', r #>> '{widgets,new,cur}';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles where role = 'builder' and is_active order by id limit 1
), true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.crm_report_period(date '2030-03-01', date '2030-03-31', date '2030-02-01', date '2030-02-28', null, null, null);
  if (r #>> '{widgets,new,cur}')::int <> 0 or jsonb_array_length(r -> 'managers') <> 0 then
    raise exception 'FAIL 13: застройщик получил данные отчёта: %', r -> 'widgets';
  end if;
end $$;
reset role;

rollback;

-- Последняя строка (после ROLLBACK — только сообщение, данных не трогает).
select 'OK: qa-55' as result;
