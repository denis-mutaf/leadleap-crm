-- Смоук тикета 39: SLA первого ответа по рабочим часам и эскалация.
-- Прогнать ПОСЛЕ применения 20261007110000_sla_working_hours.sql.
-- BEGIN…ROLLBACK, без DDL; настройки, правила и сделки правятся только внутри транзакции.
-- Ожидаемо: последняя строка 'OK: qa-39'.
-- Даты: 2026-10-12 — понедельник, 10-10 — суббота; октябрьское время Кишинёва UTC+3.
begin;

-- Расписание: пн–пт 09:00–18:00, выходные; праздников нет. Живые сделки — «с года назад».
update settings set value = '{"tz":"Europe/Chisinau","days":{"1":{"start":"09:00","end":"18:00"},"2":{"start":"09:00","end":"18:00"},"3":{"start":"09:00","end":"18:00"},"4":{"start":"09:00","end":"18:00"},"5":{"start":"09:00","end":"18:00"},"6":null,"7":null},"holidays":[]}'::jsonb
 where key = 'working_hours';
update settings set value = '{"minutes":30}'::jsonb where key = 'sla_first_response';
update settings set value = to_jsonb(now() - interval '1 year') where key = 'sla_live_since';

-- A. Арифметика рабочего времени -------------------------------------------------------
do $$
declare
  r timestamp;
begin
  -- в рабочее время срок идёт подряд
  r := public.add_working_minutes(timestamp '2026-10-12 10:00' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-12 10:30' then raise exception 'FAIL A1: %', r; end if;

  -- вечер: остаток переносится на утро следующего рабочего дня
  r := public.add_working_minutes(timestamp '2026-10-12 17:45' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-13 09:15' then raise exception 'FAIL A2: %', r; end if;

  -- ночью срок отсчитывается от начала рабочего дня
  r := public.add_working_minutes(timestamp '2026-10-12 03:00' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-12 09:30' then raise exception 'FAIL A3: %', r; end if;

  -- суббота → понедельник
  r := public.add_working_minutes(timestamp '2026-10-10 12:00' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-12 09:30' then raise exception 'FAIL A4: %', r; end if;

  -- пятница вечером → понедельник
  r := public.add_working_minutes(timestamp '2026-10-09 17:50' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-12 09:20' then raise exception 'FAIL A5: %', r; end if;

  -- праздничная дата выпадает из счёта
  update settings set value = jsonb_set(value, '{holidays}', '["2026-10-13"]'::jsonb) where key = 'working_hours';
  r := public.add_working_minutes(timestamp '2026-10-12 17:45' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-14 09:15' then raise exception 'FAIL A6: %', r; end if;
  if public.working_minutes_between(
       timestamp '2026-10-12 17:00' at time zone 'Europe/Chisinau',
       timestamp '2026-10-14 10:00' at time zone 'Europe/Chisinau') <> 120 then
    raise exception 'FAIL A6b: праздник посчитан рабочим днём';
  end if;
  update settings set value = jsonb_set(value, '{holidays}', '[]'::jsonb) where key = 'working_hours';

  -- рабочие минуты между моментами, в обе стороны; выходные дают ноль
  if public.working_minutes_between(
       timestamp '2026-10-12 10:00' at time zone 'Europe/Chisinau',
       timestamp '2026-10-13 10:00' at time zone 'Europe/Chisinau') <> 540 then
    raise exception 'FAIL A7: сутки рабочего времени';
  end if;
  if public.working_minutes_between(
       timestamp '2026-10-13 10:00' at time zone 'Europe/Chisinau',
       timestamp '2026-10-12 10:00' at time zone 'Europe/Chisinau') <> -540 then
    raise exception 'FAIL A7b: знак минут';
  end if;
  if public.working_minutes_between(
       timestamp '2026-10-10 10:00' at time zone 'Europe/Chisinau',
       timestamp '2026-10-11 20:00' at time zone 'Europe/Chisinau') <> 0 then
    raise exception 'FAIL A8: выходные посчитаны рабочими';
  end if;

  -- ни одного рабочего дня: календарный запасной расчёт, SLA не теряется
  update settings set value = '{"tz":"Europe/Chisinau","days":{},"holidays":[]}'::jsonb where key = 'working_hours';
  r := public.add_working_minutes(timestamp '2026-10-10 12:00' at time zone 'Europe/Chisinau', 30) at time zone 'Europe/Chisinau';
  if r <> timestamp '2026-10-10 12:30' then raise exception 'FAIL A9: %', r; end if;
  update settings set value = '{"tz":"Europe/Chisinau","days":{"1":{"start":"09:00","end":"18:00"},"2":{"start":"09:00","end":"18:00"},"3":{"start":"09:00","end":"18:00"},"4":{"start":"09:00","end":"18:00"},"5":{"start":"09:00","end":"18:00"},"6":null,"7":null},"holidays":[]}'::jsonb
   where key = 'working_hours';
end $$;

-- B. Проверка настроек триггером ----------------------------------------------------------
do $$
begin
  begin
    update settings set value = '{"tz":"Europe/Chisinau","days":{"1":{"start":"18:00","end":"09:00"}},"holidays":[]}'::jsonb where key = 'working_hours';
    raise exception 'FAIL B1: конец раньше начала принят';
  exception when check_violation then null;
  end;
  begin
    update settings set value = '{"tz":"Nowhere/Land","days":{},"holidays":[]}'::jsonb where key = 'working_hours';
    raise exception 'FAIL B2: неизвестный часовой пояс принят';
  exception when check_violation then null;
  end;
  begin
    update settings set value = '{"tz":"Europe/Chisinau","days":{},"holidays":["не дата"]}'::jsonb where key = 'working_hours';
    raise exception 'FAIL B3: мусор в праздниках принят';
  exception when check_violation then null;
  end;
  begin
    update settings set value = '{"minutes":0}'::jsonb where key = 'sla_first_response';
    raise exception 'FAIL B4: нулевой срок принят';
  exception when check_violation then null;
  end;
end $$;

-- C. Срок при создании сделки; ручная сделка отвечена сразу -------------------------------------
do $$
declare
  s1 uuid; c uuid; d1 uuid; d2 uuid; adm uuid; due timestamp; fr timestamptz;
begin
  select id into s1 from stages where is_active order by position limit 1;
  select id into adm from profiles where role = 'admin' and is_active limit 1;
  insert into contacts (full_name) values ('SMOKE-39') returning id into c;

  -- лид в субботу в полдень получает срок «понедельник 09:30»
  insert into deals (contact_id, stage_id, first_inbound_at)
  values (c, s1, timestamp '2026-10-10 12:00' at time zone 'Europe/Chisinau') returning id into d1;
  select sla_due_at at time zone 'Europe/Chisinau', first_response_at into due, fr from deals where id = d1;
  if due <> timestamp '2026-10-12 09:30' then raise exception 'FAIL C1: срок %', due; end if;
  if fr is not null then raise exception 'FAIL C1b: first_response_at у входящей заявки'; end if;

  -- сделка, заведённая сотрудником, отвеченной считается сразу
  insert into deals (contact_id, stage_id, created_by) values (c, s1, adm) returning id into d2;
  select first_response_at into fr from deals where id = d2;
  if fr is null then raise exception 'FAIL C2: ручная сделка без first_response_at'; end if;
end $$;

-- D. first_response_at: звонки, сообщения, этап, взятие из котла ---------------------------------
do $$
declare
  s1 uuid; s2 uuid; c uuid; adm uuid; mgr uuid;
  d_call uuid; d_inb uuid; d_missed uuid; d_msg uuid; d_stage uuid; d_claim uuid; d_old uuid;
  conv uuid; fr timestamptz;
begin
  select id into s1 from stages where is_active order by position limit 1;
  select id into s2 from stages where is_active and kind = 'open' and id <> s1 order by position limit 1;
  select id into adm from profiles where role = 'admin' and is_active limit 1;
  select id into mgr from profiles where role = 'manager' and is_active limit 1;
  update stages set requires_next_step = false, requires_qualification = false, requires_qualification_tag = false;

  insert into contacts (full_name) values ('SMOKE-39 звонок') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_call;
  -- входящий без ответа менеджера и недозвон входящего не считаются
  insert into calls (direction, status, contact_id, deal_id, user_id, started_at)
  values ('in', 'missed', c, d_call, mgr, now());
  select first_response_at into fr from deals where id = d_call;
  if fr is not null then raise exception 'FAIL D1: пропущенный входящий засчитан'; end if;
  insert into calls (direction, status, contact_id, deal_id, user_id, started_at)
  values ('out', 'busy', c, d_call, mgr, now());
  select first_response_at into fr from deals where id = d_call;
  if fr is null then raise exception 'FAIL D2: исходящий звонок не поставил first_response_at'; end if;

  -- звонок до появления заявки ответом не считается
  insert into contacts (full_name) values ('SMOKE-39 давний звонок') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_old;
  insert into calls (direction, status, contact_id, deal_id, user_id, started_at)
  values ('out', 'success', c, d_old, mgr, now() - interval '2 days');
  select first_response_at into fr from deals where id = d_old;
  if fr is not null then raise exception 'FAIL D3: звонок из прошлого засчитан'; end if;

  -- принятый менеджером входящий — ответ
  insert into contacts (full_name) values ('SMOKE-39 входящий') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_inb;
  insert into calls (direction, status, contact_id, deal_id, user_id, started_at)
  values ('in', 'success', c, d_inb, mgr, now());
  select first_response_at into fr from deals where id = d_inb;
  if fr is null then raise exception 'FAIL D4: принятый входящий не засчитан'; end if;

  -- звонок без привязки к сделке: все сделки контакта
  insert into contacts (full_name) values ('SMOKE-39 без сделки в звонке') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_missed;
  insert into calls (direction, status, contact_id, user_id, started_at)
  values ('out', 'success', c, mgr, now());
  select first_response_at into fr from deals where id = d_missed;
  if fr is null then raise exception 'FAIL D5: звонок без deal_id не нашёл сделку контакта'; end if;

  -- сообщение: входящее и без автора не считаются, исходящее сотрудника — да
  insert into contacts (full_name) values ('SMOKE-39 переписка') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_msg;
  insert into conversations (channel, external_thread_id, contact_id)
  values ('whatsapp', 'SMOKE-39-' || gen_random_uuid()::text, c) returning id into conv;
  insert into messages (conversation_id, direction, body, sent_at) values (conv, 'in', 'Здравствуйте', now());
  insert into messages (conversation_id, direction, body, sent_at) values (conv, 'out', 'Автоответ', now());
  select first_response_at into fr from deals where id = d_msg;
  if fr is not null then raise exception 'FAIL D6: входящее или сообщение без автора засчитано'; end if;
  insert into messages (conversation_id, direction, body, author_user_id, sent_at)
  values (conv, 'out', 'Добрый день!', mgr, now());
  select first_response_at into fr from deals where id = d_msg;
  if fr is null then raise exception 'FAIL D7: исходящее сообщение сотрудника не засчитано'; end if;

  -- этап и взятие из котла — от имени администратора, как из интерфейса
  insert into contacts (full_name) values ('SMOKE-39 этап') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_stage;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_claim;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('smoke39.d_stage', d_stage::text, true);
  perform set_config('smoke39.d_claim', d_claim::text, true);
  perform set_config('smoke39.s2', s2::text, true);
  perform set_config('smoke39.adm', adm::text, true);
end $$;

set local role authenticated;
do $$
begin
  -- взять из котла: ответственный назначен, этап прежний
  update deals set owner_id = current_setting('smoke39.adm')::uuid
   where id = current_setting('smoke39.d_claim')::uuid;
  -- перенос с первого этапа
  update deals set stage_id = current_setting('smoke39.s2')::uuid
   where id = current_setting('smoke39.d_stage')::uuid;
end $$;
reset role;

do $$
declare fr timestamptz;
begin
  select first_response_at into fr from deals where id = current_setting('smoke39.d_claim')::uuid;
  if fr is not null then raise exception 'FAIL D8: взятие из котла засчитано как ответ'; end if;
  select first_response_at into fr from deals where id = current_setting('smoke39.d_stage')::uuid;
  if fr is null then raise exception 'FAIL D9: перенос с первого этапа не поставил first_response_at'; end if;
end $$;

-- E. Эскалация -------------------------------------------------------------------------------
do $$
declare
  s1 uuid; c uuid; mgr uuid; heads int;
  d_pool uuid; d_owned uuid; d_answered uuid; d_postponed uuid; d_old uuid; d_off uuid;
  n int; first_run int; got int;
begin
  select id into s1 from stages where is_active order by position limit 1;
  select id into mgr from profiles where role = 'manager' and is_active limit 1;
  select count(*) into heads from profiles where role = 'head' and is_active;
  if heads = 0 then raise exception 'FAIL E0: нет активных руководителей для проверки'; end if;
  insert into contacts (full_name) values ('SMOKE-39 эскалация') returning id into c;

  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_pool;
  insert into deals (contact_id, stage_id, owner_id) values (c, s1, mgr) returning id into d_owned;
  insert into deals (contact_id, stage_id, first_response_at) values (c, s1, now()) returning id into d_answered;
  insert into deals (contact_id, stage_id, status, postponed_until)
  values (c, s1, 'postponed', current_date + 3) returning id into d_postponed;
  -- заявка, пришедшая до применения миграции
  insert into deals (contact_id, stage_id, first_inbound_at)
  values (c, s1, now() - interval '2 years') returning id into d_old;
  update deals set sla_due_at = now() - interval '1 hour'
   where id in (d_pool, d_owned, d_answered, d_postponed, d_old);

  -- не вовремя: срок ещё впереди
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d_off;
  update deals set sla_due_at = now() + interval '1 hour' where id = d_off;

  first_run := public.process_sla_breaches();
  if first_run < 2 then raise exception 'FAIL E1: обработано % сделок, ждали минимум 2', first_run; end if;

  if (select sla_breached_at from deals where id = d_pool) is null then raise exception 'FAIL E2: котёл не помечен'; end if;
  if (select sla_breached_at from deals where id = d_owned) is null then raise exception 'FAIL E2b: сделка с ответственным не помечена'; end if;
  if (select sla_breached_at from deals where id = d_answered) is not null then raise exception 'FAIL E3: отвеченная сделка помечена'; end if;
  if (select sla_breached_at from deals where id = d_postponed) is not null then raise exception 'FAIL E4: отложенная сделка помечена'; end if;
  if (select sla_breached_at from deals where id = d_old) is not null then raise exception 'FAIL E5: старая заявка разбудила SLA'; end if;
  if (select sla_breached_at from deals where id = d_off) is not null then raise exception 'FAIL E6: срок ещё не вышел, а сделка помечена'; end if;

  -- котёл: все активные руководители, по одному уведомлению
  select count(*) into got from notifications where kind = 'sla_breach' and deal_id = d_pool;
  if got <> heads then raise exception 'FAIL E7: по котлу % уведомлений, руководителей %', got, heads; end if;
  -- сделка с ответственным: руководители и ответственный
  select count(*) into got from notifications where kind = 'sla_breach' and deal_id = d_owned and user_id = mgr;
  if got <> 1 then raise exception 'FAIL E8: ответственный не получил уведомление'; end if;
  select count(*) into got from notifications n join profiles p on p.id = n.user_id
   where n.kind = 'sla_breach' and n.deal_id = d_owned and p.role = 'head';
  if got <> heads then raise exception 'FAIL E8b: руководители получили % уведомлений', got; end if;

  -- повторный вызов ничего не дублирует
  select count(*) into n from notifications where kind = 'sla_breach' and deal_id in (d_pool, d_owned);
  if public.process_sla_breaches() <> 0 then raise exception 'FAIL E9: повторный вызов снова что-то обработал'; end if;
  if (select count(*) from notifications where kind = 'sla_breach' and deal_id in (d_pool, d_owned)) <> n then
    raise exception 'FAIL E9b: уведомления задвоились';
  end if;

  -- уведомления выключены в правилах: сделка помечается, колокольчик молчит
  update notification_rules set in_app = false where kind = 'sla_breach';
  update deals set sla_due_at = now() - interval '5 minutes' where id = d_off;
  if public.process_sla_breaches() <> 1 then raise exception 'FAIL E10: ждали ровно одну сделку'; end if;
  if (select sla_breached_at from deals where id = d_off) is null then raise exception 'FAIL E10b: не помечена'; end if;
  if exists (select 1 from notifications where kind = 'sla_breach' and deal_id = d_off) then
    raise exception 'FAIL E10c: уведомление создано при выключенном правиле';
  end if;
  update notification_rules set in_app = true where kind = 'sla_breach';

  -- функция недоступна клиентским ролям
  if has_function_privilege('authenticated', 'public.process_sla_breaches()', 'execute')
     or has_function_privilege('anon', 'public.process_sla_breaches()', 'execute') then
    raise exception 'FAIL E11: process_sla_breaches доступна клиентским ролям';
  end if;
  if not has_function_privilege('service_role', 'public.process_sla_breaches()', 'execute') then
    raise exception 'FAIL E11b: service_role не может звать process_sla_breaches';
  end if;

  perform set_config('smoke39.d_off', d_off::text, true);
  perform set_config('smoke39.d_old', d_old::text, true);
  perform set_config('smoke39.d_answered', d_answered::text, true);
  perform set_config('smoke39.d_pool', d_pool::text, true);
end $$;

-- F. Доска: срок и остаток в карточке ----------------------------------------------------------
do $$
declare
  adm uuid; s1 uuid; c uuid; d uuid;
begin
  select id into adm from profiles where role = 'admin' and is_active limit 1;
  select id into s1 from stages where is_active order by position limit 1;
  insert into contacts (full_name) values ('SMOKE-39 доска') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s1) returning id into d;
  perform set_config('smoke39.d_board', d::text, true);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
end $$;

set local role authenticated;
do $$
declare
  board jsonb; card jsonb; d uuid := current_setting('smoke39.d_board')::uuid;
begin
  board := public.crm_board(0, 200, null, null, null, null, null, 'created');
  select x into card
    from jsonb_array_elements(board -> 'columns' -> 'kettle' -> 'deals') x
   where x ->> 'id' = d::text;
  if card is null then raise exception 'FAIL F1: свежая сделка не попала в котёл доски'; end if;
  if card ->> 'sla_due_at' is null then
    raise exception 'FAIL F2: у свежей сделки нет sla_due_at';
  end if;
  if card ->> 'sla_left_min' is null then raise exception 'FAIL F3: нет sla_left_min'; end if;
end $$;
reset role;

do $$
declare
  d uuid := current_setting('smoke39.d_board')::uuid;
  adm uuid;
begin
  select id into adm from profiles where role = 'admin' and is_active limit 1;
  update deals set sla_due_at = now() - interval '2 hours' where id = d;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
end $$;

set local role authenticated;
do $$
declare
  board jsonb; card jsonb; d uuid := current_setting('smoke39.d_board')::uuid;
begin
  board := public.crm_board(0, 200, null, null, null, null, null, 'created');
  select x into card
    from jsonb_array_elements(board -> 'columns' -> 'kettle' -> 'deals') x
   where x ->> 'id' = d::text;
  if card is null then raise exception 'FAIL F4: сделка пропала с доски'; end if;
  -- Вне рабочего времени рабочих минут после срока может быть 0: тогда просрочку видно по sla_due_at.
  if (card ->> 'sla_left_min')::int > 0 or ((card ->> 'sla_left_min')::int = 0 and (card ->> 'sla_due_at')::timestamptz >= now()) then
    raise exception 'FAIL F5: просрочка не отрицательная (%)', card ->> 'sla_left_min';
  end if;

  -- старая заявка и отвеченная сделка таймера не получают
  select x into card
    from jsonb_array_elements(board -> 'columns' -> 'kettle' -> 'deals') x
   where x ->> 'id' = current_setting('smoke39.d_old');
  if card is not null and card ->> 'sla_due_at' is not null then
    raise exception 'FAIL F6: у старой заявки есть таймер';
  end if;
  select x into card
    from jsonb_array_elements(board -> 'columns' -> 'kettle' -> 'deals') x
   where x ->> 'id' = current_setting('smoke39.d_answered');
  if card is not null and card ->> 'sla_due_at' is not null then
    raise exception 'FAIL F7: у отвеченной сделки есть таймер';
  end if;
end $$;
reset role;

select 'OK: qa-39' as result;
rollback;
