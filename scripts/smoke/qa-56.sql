-- Смоук тикета 56 (QA B-13, уведомления). Прогнать ПОСЛЕ применения
-- 20261006180000_qa_notifications_generation.sql. BEGIN…ROLLBACK, без DDL.
-- Ожидаемо: последняя строка 'OK: qa-56'.
begin;

-- 0. Функции и триггер на месте; клиентам звать их нельзя.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'deals_notify_new_lead' and not tgisinternal) then
    raise exception 'FAIL 0: нет триггера deals_notify_new_lead';
  end if;
  if has_function_privilege('authenticated', 'public.notify_incoming_call(uuid,text,text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.notify_incoming_call(uuid,text,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.attach_call_to_new_lead(uuid,uuid,text,text,uuid)', 'execute') then
    raise exception 'FAIL 0: функции уведомлений доступны клиентским ролям';
  end if;
  if not has_function_privilege('service_role', 'public.notify_incoming_call(uuid,text,text,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.attach_call_to_new_lead(uuid,uuid,text,text,uuid)', 'execute') then
    raise exception 'FAIL 0: service_role не может звать функции уведомлений';
  end if;
end $$;

-- 1. Новая сделка в котле → new_lead всем получателям котла.
do $$
declare
  s uuid; c uuid; d uuid; pool int; got int; owner_user uuid;
begin
  select id into s from public.stages where kind = 'open' and is_active order by position limit 1;
  select count(*) into pool from public.notification_pool_recipients();
  if pool < 2 then raise exception 'FAIL 1: в котле меньше двух получателей (%)', pool; end if;

  insert into public.contacts (full_name) values ('SMOKE-56 лид') returning id into c;
  insert into public.deals (contact_id, stage_id) values (c, s) returning id into d;

  select count(*) into got from public.notifications
   where kind = 'new_lead' and deal_id = d and not (payload ? 'callid');
  if got <> pool then raise exception 'FAIL 1: new_lead получили %, ждали %', got, pool; end if;
  if exists (
    select 1 from public.notifications n
     where n.deal_id = d and n.user_id not in (select public.notification_pool_recipients())
  ) then raise exception 'FAIL 1: уведомление ушло не из котла (builder или неактивному)'; end if;
  if exists (
    select 1 from public.notifications n join public.profiles p on p.id = n.user_id
     where n.deal_id = d and p.role = 'builder'
  ) then raise exception 'FAIL 1: застройщику ушёл new_lead'; end if;

  -- 2. Сделка с ответственным (ручная, из карточки) — без уведомлений.
  select id into owner_user from public.profiles where role = 'manager' and is_active order by id limit 1;
  insert into public.deals (contact_id, stage_id, owner_id) values (c, s, owner_user) returning id into d;
  select count(*) into got from public.notifications where deal_id = d;
  if got <> 0 then raise exception 'FAIL 2: сделка с ответственным дала % уведомлений', got; end if;

  -- 3. Импорт со старой датой не засыпает колокольчик.
  insert into public.deals (contact_id, stage_id, created_at) values (c, s, now() - interval '3 days') returning id into d;
  select count(*) into got from public.notifications where deal_id = d;
  if got <> 0 then raise exception 'FAIL 3: старая сделка дала % уведомлений', got; end if;

  -- 4. Автор сделки (created_by) не получает уведомление о собственной сделке.
  select id into owner_user from public.profiles where role = 'head' and is_active order by id limit 1;
  insert into public.deals (contact_id, stage_id, created_by) values (c, s, owner_user) returning id into d;
  select count(*) into got from public.notifications where deal_id = d;
  if got <> pool - 1 then raise exception 'FAIL 4: получили %, ждали % (без автора)', got, pool - 1; end if;
  if exists (select 1 from public.notifications where deal_id = d and user_id = owner_user) then
    raise exception 'FAIL 4: автору ушло уведомление';
  end if;
end $$;

-- 5. Звонок от контакта с ответственным: только ответственному, повтор не плодит.
do $$
declare
  s uuid; c uuid; d uuid; m uuid; n int;
begin
  select id into s from public.stages where kind = 'open' and is_active order by position limit 1;
  select id into m from public.profiles where role = 'manager' and is_active order by id limit 1;
  insert into public.contacts (full_name) values ('SMOKE-56 звонок с ответственным') returning id into c;
  insert into public.deals (contact_id, stage_id, owner_id, title) values (c, s, m, 'SMOKE-56 сделка') returning id into d;

  perform public.notify_incoming_call(c, '+37300000056', 'smoke56-owner', null);
  perform public.notify_incoming_call(c, '+37300000056', 'smoke56-owner', null);

  select count(*) into n from public.notifications where payload ->> 'callid' = 'smoke56-owner';
  if n <> 1 then raise exception 'FAIL 5: уведомлений о звонке %, ждали 1', n; end if;
  if not exists (
    select 1 from public.notifications
     where payload ->> 'callid' = 'smoke56-owner' and user_id = m
       and kind = 'incoming_call' and deal_id = d and contact_id = c
  ) then raise exception 'FAIL 5: уведомление не у ответственного или без сделки'; end if;
end $$;

-- 6. Звонок от контакта со сделкой в котле: оператору — карточка со звонком,
-- остальному котлу — запись без callid; повтор не плодит.
do $$
declare
  s uuid; c uuid; staff uuid; pool int; n int;
begin
  select id into s from public.stages where kind = 'open' and is_active order by position limit 1;
  select id into staff from public.profiles where role = 'manager' and is_active order by id desc limit 1;
  select count(*) into pool from public.notification_pool_recipients();
  insert into public.contacts (full_name) values ('SMOKE-56 звонок из котла') returning id into c;
  insert into public.deals (contact_id, stage_id) values (c, s);

  perform public.notify_incoming_call(c, '+37300000057', 'smoke56-pool', staff);
  perform public.notify_incoming_call(c, '+37300000057', 'smoke56-pool', staff);

  select count(*) into n from public.notifications
   where kind = 'incoming_call' and payload ->> 'callid' = 'smoke56-pool';
  if n <> 1 then raise exception 'FAIL 6: карточек со звонком %, ждали 1', n; end if;
  if not exists (
    select 1 from public.notifications
     where kind = 'incoming_call' and payload ->> 'callid' = 'smoke56-pool' and user_id = staff
  ) then raise exception 'FAIL 6: карточка со звонком не у оператора'; end if;

  select count(*) into n from public.notifications
   where kind = 'incoming_call' and payload ->> 'pool_callid' = 'smoke56-pool'
     and not (payload ? 'callid');
  if n <> pool - 1 then raise exception 'FAIL 6: записей котла %, ждали %', n, pool - 1; end if;
end $$;

-- 7. Звонок с незнакомого номера: триггер разослал new_lead, оператору запись
-- превратилась в карточку со звонком, дублей нет, повтор безопасен.
do $$
declare
  s uuid; c uuid; d uuid; staff uuid; pool int; n int;
begin
  select id into s from public.stages where kind = 'open' and is_active order by position limit 1;
  select id into staff from public.profiles where role = 'manager' and is_active order by id limit 1;
  select count(*) into pool from public.notification_pool_recipients();
  insert into public.contacts (full_name) values ('+37300000058') returning id into c;
  insert into public.deals (contact_id, stage_id) values (c, s) returning id into d;

  perform public.attach_call_to_new_lead(d, c, '+37300000058', 'smoke56-new', staff);
  perform public.attach_call_to_new_lead(d, c, '+37300000058', 'smoke56-new', staff);

  select count(*) into n from public.notifications where kind = 'new_lead' and deal_id = d;
  if n <> pool then raise exception 'FAIL 7: new_lead по сделке %, ждали % (без дублей)', n, pool; end if;
  select count(*) into n from public.notifications
   where kind = 'new_lead' and deal_id = d and payload ->> 'callid' = 'smoke56-new' and user_id = staff;
  if n <> 1 then raise exception 'FAIL 7: у оператора карточек со звонком %, ждали 1', n; end if;
end $$;

-- 8. Под пользователем: колокольчик видит только свои, счёт обычным GET-запросом.
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where role = 'head' and is_active order by id limit 1
), true);
set local role authenticated;

do $$
declare
  me uuid := auth.uid(); total int; mine int;
begin
  select count(*) into total from public.notifications;
  select count(*) into mine from public.notifications where user_id = me;
  if total <> mine then
    raise exception 'FAIL 8: пользователь видит чужие уведомления (% из %)', mine, total;
  end if;
  if not exists (
    select 1 from public.notifications
     where kind = 'new_lead' and title = 'Новый лид: SMOKE-56 лид' and user_id = me
  ) then raise exception 'FAIL 8: руководитель не получил new_lead из котла'; end if;
end $$;

select 'OK: qa-56' as result;
rollback;
