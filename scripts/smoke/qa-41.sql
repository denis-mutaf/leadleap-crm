-- Смоук тикета 41: атрибуция (колонки Meta, приём лида с кампанией, отчёт «Кампании»).
-- Прогнать ПОСЛЕ применения 20261007120000_attribution.sql. BEGIN…ROLLBACK, в базе ничего не остаётся.
-- Отчёт считается по окну марта 2030 и источнику SMOKE-41, поэтому живые сделки не мешают точным числам.
-- Ожидаемо: последняя строка 'OK: qa-41'.
begin;

-- 0. Схема и права.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'deals'
         and column_name in ('meta_adset_id', 'meta_ad_id', 'meta_form_id',
                             'meta_campaign_name', 'meta_adset_name', 'meta_ad_name')) <> 6 then
    raise exception 'FAIL 0: в deals нет колонок атрибуции Meta';
  end if;
  if not has_function_privilege('authenticated', 'public.crm_report_campaigns(date,date,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.crm_report_campaigns(date,date,text,text,text)', 'execute') then
    raise exception 'FAIL 0: crm_report_campaigns — права только у authenticated';
  end if;
  if exists (select 1 from pg_proc where proname = 'crm_report_campaigns' and prosecdef) then
    raise exception 'FAIL 0: crm_report_campaigns объявлена security definer, нужен invoker';
  end if;
  if has_function_privilege('authenticated',
       'public.process_web_form_event(uuid,text,text,text,jsonb,text,jsonb,jsonb,text,jsonb)', 'execute') then
    raise exception 'FAIL 0: process_web_form_event доступна клиентской роли';
  end if;
  if (select count(*) from pg_proc where proname = 'process_web_form_event') <> 1 then
    raise exception 'FAIL 0: process_web_form_event должна остаться одна (старая версия не снята)';
  end if;
end $$;

-- ===================================================================================
-- 1. Приём лида Meta: кампания, группа, объявление, форма пишутся в сделку.
-- ===================================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  e1 uuid; e2 uuid; e3 uuid; r jsonb; d public.deals%rowtype;
begin
  insert into public.inbound_events (channel, kind, payload, dedup_key)
  values ('lead_ads', 'leadgen', '{}'::jsonb, 'smoke41-1') returning id into e1;
  r := public.process_web_form_event(
    e1, '+37369004101', 'SMOKE-41 Лид', 'Почта: x@example.com',
    '{"form_id":"F41","form":"Квиз 41","leadgen_id":"L41"}'::jsonb, 'старый-id', '{}'::jsonb, '{}'::jsonb, 'lead_ads',
    '{"campaign_id":"C41","campaign_name":"Кампания 41","adset_id":"S41","adset_name":"Группа 41","ad_id":"A41","ad_name":"Объявление 41","form_id":"F41","lead_id":"L41"}'::jsonb);
  select * into d from public.deals where id = (r ->> 'deal_id')::uuid;
  if d.meta_campaign_id <> 'C41' then raise exception 'FAIL 1: p_meta.campaign_id не победил p_meta_campaign_id: %', d.meta_campaign_id; end if;
  if d.meta_campaign_name <> 'Кампания 41' or d.meta_adset_id <> 'S41' or d.meta_adset_name <> 'Группа 41'
     or d.meta_ad_id <> 'A41' or d.meta_ad_name <> 'Объявление 41' or d.meta_form_id <> 'F41' or d.meta_lead_id <> 'L41' then
    raise exception 'FAIL 1: колонки Meta записаны неверно: %', to_jsonb(d);
  end if;
  if d.utm ->> 'form' <> 'Квиз 41' or d.utm ->> 'leadgen_id' <> 'L41' then
    raise exception 'FAIL 1: utm потерял форму или leadgen_id: %', d.utm;
  end if;

  -- 2. Лид без расширенных данных (нет токена на рекламу): сделка создаётся, поля пустые.
  insert into public.inbound_events (channel, kind, payload, dedup_key)
  values ('lead_ads', 'leadgen', '{}'::jsonb, 'smoke41-2') returning id into e2;
  r := public.process_web_form_event(
    e2, '+37369004102', 'SMOKE-41 Без данных', null, '{"leadgen_id":"L42"}'::jsonb, null, '{}'::jsonb, '{}'::jsonb, 'lead_ads',
    '{"campaign_id":null,"ad_id":"A42","lead_id":"L42"}'::jsonb);
  select * into d from public.deals where id = (r ->> 'deal_id')::uuid;
  if d.meta_campaign_id is not null or d.meta_campaign_name is not null or d.meta_ad_id <> 'A42' then
    raise exception 'FAIL 2: пустая кампания записана как значение: %', to_jsonb(d);
  end if;

  -- 3. Форма сайта: вызов без p_meta работает как раньше, utm и кампания из прежних аргументов.
  insert into public.inbound_events (channel, kind, payload, dedup_key)
  values ('web_form', 'form_submit', '{}'::jsonb, 'smoke41-3') returning id into e3;
  r := public.process_web_form_event(
    e3, '+37369004103', 'SMOKE-41 Сайт', null,
    '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"brand","gclid":"G41","page_url":"https://example.com/p"}'::jsonb,
    'M-site', '{}'::jsonb, '{}'::jsonb);
  select * into d from public.deals where id = (r ->> 'deal_id')::uuid;
  if d.meta_campaign_id <> 'M-site' or d.meta_adset_id is not null or d.utm ->> 'gclid' <> 'G41'
     or d.utm ->> 'page_url' <> 'https://example.com/p' then
    raise exception 'FAIL 3: форма сайта без p_meta сломана: %', to_jsonb(d);
  end if;
end $$;

-- ===================================================================================
-- Данные отчёта. Триггеры выключены на время вставки (нужны точные даты и свои переходы).
-- ===================================================================================
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.role', '', true);
set local session_replication_role = replica;

do $$
declare
  s0 uuid; smeet uuid; sresv uuid; kv uuid; src uuid;
  cA uuid; cB uuid; cC uuid; cD uuid; cF uuid;
  dA uuid; dB uuid; dC uuid; dD uuid; dF uuid;
begin
  select id into s0 from public.stages where kind = 'open' and is_active order by position limit 1;
  select id into smeet from public.stages where import_key = 'amo:stage:60';
  select id into sresv from public.stages where import_key = 'amo:stage:90';
  select id into kv from public.tags where name = 'КВАЛ';
  if s0 is null or smeet is null or sresv is null or kv is null then
    raise exception 'FAIL setup: нет этапов amo:stage:60 / amo:stage:90 или тега КВАЛ';
  end if;
  insert into public.sources (code, name) values ('smoke41', 'SMOKE-41 источник') returning id into src;

  insert into public.contacts (full_name) values ('SMOKE-41 A') returning id into cA;
  insert into public.contacts (full_name) values ('SMOKE-41 B') returning id into cB;
  insert into public.contacts (full_name) values ('SMOKE-41 C') returning id into cC;
  insert into public.contacts (full_name) values ('SMOKE-41 D') returning id into cD;
  insert into public.contacts (full_name) values ('SMOKE-41 F') returning id into cF;

  -- Окно: 01–31.03.2030 (Europe/Chisinau), источник SMOKE-41.
  -- A: создана 10.03, импортный ключ campaign, кампания Meta M41 с именем, КВАЛ, встреча 12.03, резервация 20.03.
  insert into public.deals (contact_id, stage_id, status, source_id, created_at, title, utm, meta_campaign_id, meta_campaign_name)
  values (cA, sresv, 'open', src, timestamptz '2030-03-10 10:00+00', 'SMOKE-41 A',
          '{"campaign":"Smoke41-A"}'::jsonb, 'M41', 'Кампания SMOKE-41') returning id into dA;
  -- B: создана 15.03, utm_campaign той же кампании с другим регистром и пробелами, без метки КВАЛ.
  insert into public.deals (contact_id, stage_id, status, source_id, created_at, title, utm, meta_campaign_id)
  values (cB, s0, 'open', src, timestamptz '2030-03-15 10:00+00', 'SMOKE-41 B',
          '{"utm_campaign":"  SMOKE41-a "}'::jsonb, 'M41') returning id into dB;
  -- C: создана 20.03, без кампании.
  insert into public.deals (contact_id, stage_id, status, source_id, created_at, title)
  values (cC, s0, 'open', src, timestamptz '2030-03-20 10:00+00', 'SMOKE-41 C') returning id into dC;
  -- D: создана в феврале, резервация 05.03 — попадает в «резерваций», но не в «обращений» и не в конверсию.
  insert into public.deals (contact_id, stage_id, status, source_id, created_at, title, utm, meta_campaign_id)
  values (cD, sresv, 'open', src, timestamptz '2030-02-10 10:00+00', 'SMOKE-41 D',
          '{"utm_campaign":"smoke41-a"}'::jsonb, 'M41') returning id into dD;
  -- F: 31.03 22:30 UTC = 01.04 по Кишинёву — в март не попадает.
  insert into public.deals (contact_id, stage_id, status, source_id, created_at, title, utm)
  values (cF, s0, 'open', src, timestamptz '2030-03-31 22:30+00', 'SMOKE-41 F',
          '{"utm_campaign":"smoke41-a"}'::jsonb) returning id into dF;

  insert into public.deal_tags (deal_id, tag_id) values (dA, kv), (dC, kv);

  insert into public.stage_transitions (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_at)
  select v.d, v.f, v.t,
         (select kind::text::public.deal_status from public.stages where id = v.f),
         (select kind::text::public.deal_status from public.stages where id = v.t),
         v.at
  from (values
    (dA, s0, smeet, timestamptz '2030-03-12 09:00+00'),
    (dA, smeet, sresv, timestamptz '2030-03-20 09:00+00'),
    (dA, s0, s0, timestamptz '2030-03-21 09:00+00'),
    (dD, s0, sresv, timestamptz '2030-03-05 09:00+00')
  ) as v(d, f, t, at);

  perform set_config('smoke41.src', src::text, true);
end $$;

set local session_replication_role = origin;

-- ===================================================================================
-- Руководитель: отчёт «Кампании».
-- ===================================================================================
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles where role = 'head' and is_active order by id limit 1
), true);
set local role authenticated;

do $$
declare
  src text := current_setting('smoke41.src');
  r jsonb; x jsonb;
begin
  r := public.crm_report_campaigns(date '2030-03-01', date '2030-03-31', src, null, null);

  -- 4. По UTM: A и B — одна кампания (регистр и пробелы не различаются), D добавляет резервацию.
  select e into x from jsonb_array_elements(r -> 'utm') e where (e ->> 'key') = 'smoke41-a';
  if x is null or (x ->> 'obr')::int <> 2 or (x ->> 'kval')::int <> 1 or (x ->> 'met')::int <> 1
     or (x ->> 'resv')::int <> 2 or (x ->> 'conv')::int <> 1 then
    raise exception 'FAIL 4: строка UTM-кампании %, ждали obr 2, kval 1, met 1, resv 2, conv 1', x;
  end if;
  -- имя — любой из вариантов написания (какой именно, зависит от сортировки базы)
  if lower(x ->> 'name') <> 'smoke41-a' then raise exception 'FAIL 4: имя UTM-кампании %', x ->> 'name'; end if;
  select e into x from jsonb_array_elements(r -> 'utm') e where (e ->> 'key') = 'none';
  if x is null or (x ->> 'obr')::int <> 1 or (x ->> 'kval')::int <> 1 or (x ->> 'resv')::int <> 0 then
    raise exception 'FAIL 4: строка «без UTM-кампании» % (ждали obr 1 — сделка C; F в апреле)', x;
  end if;

  -- 5. По кампании Meta: M41 с именем из любой сделки группы, C без кампании в «none».
  select e into x from jsonb_array_elements(r -> 'meta') e where (e ->> 'key') = 'M41';
  if x is null or (x ->> 'obr')::int <> 2 or (x ->> 'kval')::int <> 1 or (x ->> 'met')::int <> 1
     or (x ->> 'resv')::int <> 2 or (x ->> 'conv')::int <> 1 or (x ->> 'name') <> 'Кампания SMOKE-41' then
    raise exception 'FAIL 5: строка кампании Meta %', x;
  end if;
  select e into x from jsonb_array_elements(r -> 'meta') e where (e ->> 'key') = 'none';
  if x is null or (x ->> 'obr')::int <> 1 then raise exception 'FAIL 5: строка «без кампании Meta» %', x; end if;

  -- 6. Границы суток: апрель видит F (01.04 по Кишинёву), в марте её не было.
  r := public.crm_report_campaigns(date '2030-04-01', date '2030-04-30', src, null, null);
  select e into x from jsonb_array_elements(r -> 'utm') e where (e ->> 'key') = 'smoke41-a';
  if x is null or (x ->> 'obr')::int <> 1 then raise exception 'FAIL 6: апрель не увидел сделку F: %', r -> 'utm'; end if;

  -- 7. Фильтры: источник «не указан» не видит сделки SMOKE-41; менеджер без сделок — пусто.
  r := public.crm_report_campaigns(date '2030-03-01', date '2030-03-31', 'none', null, null);
  if exists (select 1 from jsonb_array_elements(r -> 'utm') e where (e ->> 'key') = 'smoke41-a') then
    raise exception 'FAIL 7: фильтр «источник не указан» пропустил сделки с источником';
  end if;
  r := public.crm_report_campaigns(date '2030-03-01', date '2030-03-31', src, '00000000-0000-0000-0000-000000000000', null);
  if jsonb_array_length(r -> 'utm') <> 0 or jsonb_array_length(r -> 'meta') <> 0 then
    raise exception 'FAIL 7: фильтр по несуществующему менеджеру вернул строки: %', r;
  end if;
end $$;

-- 8. Застройщик отчёт кампаний не видит (как и остальные отчёты за период).
select set_config('request.jwt.claim.sub', coalesce((
  select id::text from public.profiles where role = 'builder' and is_active order by id limit 1
), '00000000-0000-0000-0000-000000000001'), true);
do $$
declare r jsonb;
begin
  r := public.crm_report_campaigns(date '2030-03-01', date '2030-03-31', current_setting('smoke41.src'), null, null);
  if jsonb_array_length(r -> 'utm') <> 0 or jsonb_array_length(r -> 'meta') <> 0 then
    raise exception 'FAIL 8: застройщик получил кампании: %', r;
  end if;
end $$;

rollback;
select 'OK: qa-41' as result;
