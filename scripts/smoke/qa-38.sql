-- Смоук тикета 38: «Отложить до…». Прогнать ПОСЛЕ применения
-- 20261007100000_postpone.sql и 20261007101000_postpone_keep_touch.sql. BEGIN…ROLLBACK, без DDL.
-- Ожидаемо: последняя строка 'OK: qa-38'.
begin;

do $$
declare
  m uuid; s10 uuid; s20 uuid; sl uuid; reason uuid;
  c uuid; d uuid; d_pool uuid; d_future uuid; d_won uuid;
  today date := (now() at time zone 'Europe/Chisinau')::date;
  n int; got timestamptz; st text; pdate date; pool int; ret int;
begin
  select id into m from profiles where role = 'manager' and is_active order by id limit 1;
  select id into s10 from stages where import_key = 'amo:stage:10';
  select id into s20 from stages where import_key = 'amo:stage:20';
  select id into sl from stages where kind = 'lost' and is_active limit 1;
  select id into reason from lost_reasons where is_active limit 1;
  select count(*) into pool from notification_pool_recipients();
  -- гейты следующего шага мешают только проверке переходов
  update stages set requires_next_step = false, requires_qualification = false, requires_qualification_tag = false;

  insert into contacts (full_name) values ('SMOKE-38') returning id into c;
  insert into deals (contact_id, stage_id, owner_id, title) values (c, s10, m, 'SMOKE-38') returning id into d;

  -- 0. Права: автовозврат только планировщику.
  if has_function_privilege('authenticated', 'public.process_postponed_due()', 'execute')
     or has_function_privilege('anon', 'public.process_postponed_due()', 'execute') then
    raise exception 'FAIL 0: process_postponed_due доступна клиентским ролям';
  end if;
  if not has_function_privilege('service_role', 'public.process_postponed_due()', 'execute') then
    raise exception 'FAIL 0: service_role не может звать process_postponed_due';
  end if;

  -- 1. Валидация даты: прошлое, сегодня, пусто.
  perform set_config('request.jwt.claim.sub', m::text, true);
  set local role authenticated;
  begin
    perform postpone_crm_deal(d, today - 1, null);
    raise exception 'FAIL 1a: отложили на вчера';
  exception when check_violation then null;
  end;
  begin
    perform postpone_crm_deal(d, today, null);
    raise exception 'FAIL 1b: отложили на сегодня';
  exception when check_violation then null;
  end;
  begin
    perform postpone_crm_deal(d, null, null);
    raise exception 'FAIL 1c: отложили без даты';
  exception when check_violation then null;
  end;

  -- 2. Отложить на неделю с комментарием: этап прежний, статус postponed, задача касания.
  perform postpone_crm_deal(d, today + 7, '  Уехал в отпуск  ');
  reset role;
  select status::text, postponed_until into st, pdate from deals where id = d;
  if st <> 'postponed' or pdate <> today + 7 then raise exception 'FAIL 2a: статус % дата %', st, pdate; end if;
  if (select stage_id from deals where id = d) <> s10 then raise exception 'FAIL 2b: этап сменился'; end if;
  select count(*) into n from tasks
   where deal_id = d and is_auto and title = 'Касание по отложенной сделке' and done_at is null and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 2c: открытых задач касания %', n; end if;
  select due_at into got from tasks
   where deal_id = d and is_auto and title = 'Касание по отложенной сделке' and done_at is null;
  if got <> ((today + 7)::timestamp + time '09:00') at time zone 'Europe/Chisinau' then
    raise exception 'FAIL 2d: срок задачи %', got;
  end if;
  if (select assignee_id from tasks where deal_id = d and title = 'Касание по отложенной сделке' and done_at is null) <> m then
    raise exception 'FAIL 2e: задача не у ответственного';
  end if;
  if not exists (select 1 from notes where deal_id = d and author_id = m and body = 'Отложена до ' || to_char(today + 7, 'DD.MM.YYYY') || ': Уехал в отпуск') then
    raise exception 'FAIL 2f: комментарий не попал в ленту';
  end if;
  if not exists (select 1 from stage_transitions where deal_id = d and from_status = 'open' and to_status = 'postponed') then
    raise exception 'FAIL 2g: нет записи о смене статуса';
  end if;

  -- 3. Та же дата повторно и новая дата: задача одна, срок переехал.
  perform set_config('request.jwt.claim.sub', m::text, true);
  set local role authenticated;
  perform postpone_crm_deal(d, today + 7, null);
  perform postpone_crm_deal(d, today + 14, null);
  reset role;
  select count(*) into n from tasks
   where deal_id = d and is_auto and title = 'Касание по отложенной сделке' and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 3a: задач касания всего %', n; end if;
  select due_at into got from tasks where deal_id = d and title = 'Касание по отложенной сделке' and done_at is null;
  if got <> ((today + 14)::timestamp + time '09:00') at time zone 'Europe/Chisinau' then
    raise exception 'FAIL 3b: срок не перенесён: %', got;
  end if;

  -- 4. Вернуть в работу: статус open, дата очищена, задача касания закрыта.
  perform set_config('request.jwt.claim.sub', m::text, true);
  set local role authenticated;
  perform resume_crm_deal(d);
  perform resume_crm_deal(d); -- повтор — не ошибка
  reset role;
  select status::text, postponed_until into st, pdate from deals where id = d;
  if st <> 'open' or pdate is not null then raise exception 'FAIL 4a: статус % дата %', st, pdate; end if;
  select count(*) into n from tasks
   where deal_id = d and title = 'Касание по отложенной сделке' and done_at is null and deleted_at is null;
  if n <> 0 then raise exception 'FAIL 4b: осталась открытая задача касания (%)', n; end if;

  -- 5. Переход по этапу снимает статус и дату, но задача касания остаётся будущим шагом.
  update deals set status = 'postponed', postponed_until = today + 3 where id = d;
  select count(*) into n from tasks where deal_id = d and title = 'Касание по отложенной сделке' and done_at is null and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 5a: после повторного откладывания открытых задач %', n; end if;
  update deals set stage_id = s20 where id = d;
  select status::text, postponed_until into st, pdate from deals where id = d;
  if st <> 'open' or pdate is not null then raise exception 'FAIL 5b: статус % дата % после перехода', st, pdate; end if;
  select count(*) into n from tasks where deal_id = d and title = 'Касание по отложенной сделке' and done_at is null and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 5c: задача касания после перехода по этапу: открытых % (ждали 1, она остаётся следующим шагом)', n; end if;

  -- 6. Отказ вручную снимает отложенность.
  update deals set status = 'postponed', postponed_until = today + 3 where id = d;
  update deals set stage_id = sl, lost_reason_id = reason where id = d;
  select status::text, postponed_until into st, pdate from deals where id = d;
  if st <> 'lost' or pdate is not null then raise exception 'FAIL 6: статус % дата %', st, pdate; end if;
  -- в БД отказ задачу не закрывает (это делает модалка отказа)
  select count(*) into n from tasks where deal_id = d and title = 'Касание по отложенной сделке' and done_at is null and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 6b: задач касания после отказа %', n; end if;

  -- 7. Закрытую сделку отложить нельзя.
  perform set_config('request.jwt.claim.sub', m::text, true);
  set local role authenticated;
  begin
    perform postpone_crm_deal(d, today + 5, null);
    raise exception 'FAIL 7: отложили проигранную сделку';
  exception when check_violation then null;
  end;
  reset role;

  -- Дальше — как планировщик: без пользователя в сессии.
  perform set_config('request.jwt.claim.sub', '', true);

  -- 8. Автовозврат: дата касания прошла у сделки с ответственным и без него;
  --    будущая остаётся отложенной.
  insert into deals (contact_id, stage_id, owner_id, title, created_at)
    values (c, s10, m, 'SMOKE-38 due', now() - interval '1 day') returning id into d_won;
  update deals set status = 'postponed', postponed_until = today - 1 where id = d_won;
  insert into deals (contact_id, stage_id, title, created_at)
    values (c, s10, 'SMOKE-38 pool', now() - interval '1 day') returning id into d_pool;
  update deals set status = 'postponed', postponed_until = today - 1 where id = d_pool;
  insert into deals (contact_id, stage_id, owner_id, title, created_at)
    values (c, s10, m, 'SMOKE-38 future', now() - interval '1 day') returning id into d_future;
  update deals set status = 'postponed', postponed_until = today + 10 where id = d_future;

  -- задача касания у «due» уже создана триггером, один раз
  select count(*) into n from tasks where deal_id = d_won and title = 'Касание по отложенной сделке' and done_at is null;
  if n <> 1 then raise exception 'FAIL 8a: задач касания у due %', n; end if;

  ret := process_postponed_due();
  if ret < 2 then raise exception 'FAIL 8b: вернулось % сделок, ждали не меньше 2', ret; end if;
  if (select status::text from deals where id = d_won) <> 'open'
     or (select postponed_until from deals where id = d_won) is not null then
    raise exception 'FAIL 8c: due не вернулась в работу';
  end if;
  if (select status::text from deals where id = d_pool) <> 'open' then
    raise exception 'FAIL 8d: pool не вернулась в работу';
  end if;
  if (select status::text from deals where id = d_future) <> 'postponed' then
    raise exception 'FAIL 8e: будущая сделка вернулась раньше срока';
  end if;
  -- задача касания не продублирована и не закрыта автовозвратом
  select count(*) into n from tasks where deal_id = d_won and title = 'Касание по отложенной сделке' and deleted_at is null;
  if n <> 1 then raise exception 'FAIL 8f: задач касания у due после возврата %', n; end if;
  if (select done_at from tasks where deal_id = d_won and title = 'Касание по отложенной сделке') is not null then
    raise exception 'FAIL 8g: автовозврат закрыл задачу касания';
  end if;
  -- уведомления: ответственному одно, у сделки без ответственного — всем получателям котла
  select count(*) into n from notifications where deal_id = d_won and kind = 'postponed_due' and user_id = m;
  if n <> 1 then raise exception 'FAIL 8h: уведомлений ответственному %', n; end if;
  select count(*) into n from notifications where deal_id = d_won and kind = 'postponed_due';
  if n <> 1 then raise exception 'FAIL 8i: уведомление ушло не только ответственному (%)', n; end if;
  select count(*) into n from notifications where deal_id = d_pool and kind = 'postponed_due';
  if n <> pool then raise exception 'FAIL 8j: котёл получил %, ждали %', n, pool; end if;
  -- в ленте: изменение статуса записано системой
  if not exists (select 1 from stage_transitions where deal_id = d_won and from_status = 'postponed' and to_status = 'open' and changed_by is null) then
    raise exception 'FAIL 8k: нет записи о возврате в ленте';
  end if;

  -- 9. Идемпотентность: повторный вызов ничего не дублирует.
  ret := process_postponed_due();
  if ret <> 0 then raise exception 'FAIL 9a: повторный вызов вернул %', ret; end if;
  select count(*) into n from notifications where deal_id in (d_won, d_pool) and kind = 'postponed_due';
  if n <> 1 + pool then raise exception 'FAIL 9b: уведомлений стало %', n; end if;

  -- 10. Фильтр таблицы: «Отложенные» видит только отложенные.
  perform set_config('request.jwt.claim.sub', m::text, true);
  set local role authenticated;
  if not exists (select 1 from crm_deals_table(null, null, null, 'postponed') t where t.id = d_future) then
    raise exception 'FAIL 10a: отложенная сделка не попала в фильтр';
  end if;
  if exists (select 1 from crm_deals_table(null, null, null, 'postponed') t where t.id in (d_won, d_pool)) then
    raise exception 'FAIL 10b: вернувшаяся сделка осталась в фильтре';
  end if;
  reset role;
end $$;

select 'OK: qa-38' as result;
rollback;
