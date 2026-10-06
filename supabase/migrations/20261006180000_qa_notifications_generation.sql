-- QA B-13 / тикет 56: колокольчик пустой. Уведомления new_lead и incoming_call
-- создавал только вебхук АТС и только оператору, на чьём внутреннем номере
-- звонили; лиды из Meta, формы сайта, мессенджеров и ручные сделки не давали
-- ничего. Теперь генерация живёт в базе и не зависит от канала.
--
-- Что делает файл:
--   1. notification_pool_recipients() — кому уходит «общий котёл»: активные
--      менеджеры, руководители и администраторы.
--   2. Триггер deals_notify_new_lead: новая сделка без ответственного (общий
--      котёл) → new_lead всем получателям котла, кроме автора сделки.
--   3. notify_incoming_call() — входящий звонок известного контакта:
--      ответственному по открытой сделке, если ответственного нет — в котёл.
--   4. attach_call_to_new_lead() — звонок с незнакомого номера: оператору
--      уходит карточка со звонком (callid → окно входящего), остальные уже
--      получили new_lead от триггера.
-- SLA и рабочие часы не затрагиваются (тикет 39).
--
-- Окно входящего звонка показывает только строки с payload.callid, поэтому
-- записи для остальных получателей идут без callid (ключ pool_callid): в
-- колокольчике они есть, всплывающей карточки нет.

-- 1. Получатели общего котла -------------------------------------------------
create or replace function public.notification_pool_recipients()
returns setof uuid
language sql stable
set search_path = public, pg_temp
as $fn$
  select p.id
    from public.profiles p
   where p.is_active
     and p.role in ('manager', 'head', 'admin');
$fn$;

revoke all on function public.notification_pool_recipients()
  from public, anon, authenticated;
grant execute on function public.notification_pool_recipients() to service_role;

-- Админ может выключить событие в notification_rules (in_app = false).
create or replace function public.notification_in_app_enabled(p_kind public.notification_kind)
returns boolean
language sql stable
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select bool_or(r.is_active and r.in_app)
       from public.notification_rules r
      where r.kind = p_kind),
    true
  );
$fn$;

revoke all on function public.notification_in_app_enabled(public.notification_kind)
  from public, anon, authenticated;
grant execute on function public.notification_in_app_enabled(public.notification_kind)
  to service_role;

-- 2. Новая сделка в котле → new_lead ------------------------------------------
create or replace function public.deals_notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name   text;
  v_source text;
begin
  -- Только живая сделка в котле. Импорт из amoCRM пишет старые created_at —
  -- он не должен засыпать колокольчик.
  if new.owner_id is not null
     or new.deleted_at is not null
     or new.created_at < now() - interval '10 minutes' then
    return new;
  end if;
  if not public.notification_in_app_enabled('new_lead') then
    return new;
  end if;

  select c.full_name into v_name from public.contacts c where c.id = new.contact_id;
  select s.name into v_source from public.sources s where s.id = new.source_id;

  insert into public.notifications (user_id, kind, title, body, deal_id, contact_id, payload)
  select r,
         'new_lead',
         'Новый лид: ' || coalesce(nullif(v_name, ''), 'без имени'),
         case when v_source is null
              then 'Сделка в общем котле.'
              else 'Источник: ' || v_source || '. Сделка в общем котле.'
         end,
         new.id,
         new.contact_id,
         jsonb_build_object('deal_id', new.id)
    from public.notification_pool_recipients() r
   where r is distinct from new.created_by;
  return new;
exception when others then
  -- Сбой уведомления не должен ронять создание сделки.
  raise warning 'deals_notify_new_lead: %', sqlerrm;
  return new;
end;
$fn$;

revoke all on function public.deals_notify_new_lead() from public, anon, authenticated;

drop trigger if exists deals_notify_new_lead on public.deals;
create trigger deals_notify_new_lead
  after insert on public.deals
  for each row execute function public.deals_notify_new_lead();

-- 3. Входящий звонок известного контакта --------------------------------------
-- Зовёт вебхук АТС с сервисным ключом на событие INCOMING. Повтор вебхука
-- безопасен: на callid стоит уникальный индекс, у котла — проверка.
create or replace function public.notify_incoming_call(
  p_contact_id uuid,
  p_phone      text,
  p_callid     text,
  p_staff_id   uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name   text;
  v_deals  uuid[];
  v_titles text;
  v_owners uuid[];
  v_title  text;
  v_body   text;
  v_deal   uuid;
  v_payload jsonb;
  v_staff  uuid;
begin
  if p_callid is null or p_callid = '' then return; end if;
  if not public.notification_in_app_enabled('incoming_call') then return; end if;

  select c.full_name into v_name from public.contacts c where c.id = p_contact_id;

  select coalesce(array_agg(d.id order by d.created_at), '{}'),
         coalesce(string_agg(coalesce(d.title, 'Без названия'), ', ' order by d.created_at), ''),
         coalesce(array_agg(distinct d.owner_id) filter (
           where d.owner_id is not null
             and exists (select 1 from public.profiles p where p.id = d.owner_id and p.is_active)
         ), '{}')
    into v_deals, v_titles, v_owners
    from public.deals d
   where d.contact_id = p_contact_id
     and d.status = 'open'
     and d.deleted_at is null;

  v_title := 'Входящий звонок: ' || coalesce(nullif(v_name, ''), p_phone);
  v_body := 'Сделки: ' || coalesce(nullif(v_titles, ''), 'сделок нет');
  v_deal := case when cardinality(v_deals) = 1 then v_deals[1] else null end;
  v_payload := jsonb_build_object(
    'phone', p_phone, 'callid', p_callid, 'deals', to_jsonb(v_deals));

  if cardinality(v_owners) > 0 then
    -- Ответственные по сделкам: у каждого карточка со звонком.
    insert into public.notifications (user_id, kind, title, body, contact_id, deal_id, payload)
    select o, 'incoming_call', v_title, v_body, p_contact_id, v_deal, v_payload
      from unnest(v_owners) o
    on conflict (user_id, kind, ((payload ->> 'callid')))
      where kind in ('incoming_call', 'new_lead') and payload ? 'callid'
    do nothing;
    return;
  end if;

  -- Сделки в котле: оператор, принявший звонок, получает карточку со звонком,
  -- остальные получатели котла — запись в колокольчик без всплывающего окна.
  select p.id into v_staff
    from public.profiles p
   where p.id = p_staff_id and p.is_active;
  if v_staff is not null then
    insert into public.notifications (user_id, kind, title, body, contact_id, deal_id, payload)
    values (v_staff, 'incoming_call', v_title, v_body, p_contact_id, v_deal, v_payload)
    on conflict (user_id, kind, ((payload ->> 'callid')))
      where kind in ('incoming_call', 'new_lead') and payload ? 'callid'
    do nothing;
  end if;

  insert into public.notifications (user_id, kind, title, body, contact_id, deal_id, payload)
  select r, 'incoming_call', v_title, v_body, p_contact_id, v_deal,
         (v_payload - 'callid') || jsonb_build_object('pool_callid', p_callid)
    from public.notification_pool_recipients() r
   where r is distinct from v_staff
     and not exists (
       select 1 from public.notifications n
        where n.user_id = r
          and n.kind = 'incoming_call'
          and n.payload ->> 'pool_callid' = p_callid
     );
end;
$fn$;

revoke all on function public.notify_incoming_call(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.notify_incoming_call(uuid, text, text, uuid)
  to service_role;

-- 4. Звонок с незнакомого номера -----------------------------------------------
-- Контакт и сделка в котле уже созданы вебхуком, триггер разослал new_lead.
-- Оператору превращаем его запись в карточку звонка (callid → окно входящего);
-- если записи нет (оператор не из получателей котла) — создаём.
create or replace function public.attach_call_to_new_lead(
  p_deal_id    uuid,
  p_contact_id uuid,
  p_phone      text,
  p_callid     text,
  p_staff_id   uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_title   text := 'Новый лид: звонок с ' || p_phone;
  v_body    text := 'Контакт и сделка созданы автоматически из входящего звонка.';
  v_payload jsonb := jsonb_build_object('phone', p_phone, 'callid', p_callid);
  v_updated int;
begin
  if p_callid is null or p_callid = '' or p_staff_id is null then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_staff_id and p.is_active) then
    return;
  end if;
  if not public.notification_in_app_enabled('new_lead') then return; end if;

  update public.notifications n
     set title = v_title,
         body = v_body,
         payload = n.payload || v_payload
   where n.user_id = p_staff_id
     and n.kind = 'new_lead'
     and n.deal_id = p_deal_id
     and not (n.payload ? 'callid');
  get diagnostics v_updated = row_count;
  if v_updated > 0 then return; end if;

  insert into public.notifications (user_id, kind, title, body, contact_id, deal_id, payload)
  values (p_staff_id, 'new_lead', v_title, v_body, p_contact_id, p_deal_id, v_payload)
  on conflict (user_id, kind, ((payload ->> 'callid')))
    where kind in ('incoming_call', 'new_lead') and payload ? 'callid'
  do nothing;
end;
$fn$;

revoke all on function public.attach_call_to_new_lead(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.attach_call_to_new_lead(uuid, uuid, text, text, uuid)
  to service_role;
