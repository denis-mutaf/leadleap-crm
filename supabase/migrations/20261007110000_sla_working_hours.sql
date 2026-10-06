-- QA / тикет 39: SLA первого ответа по рабочим часам и эскалация руководителю.
-- Раньше sla_due_at считался в календарных минутах, first_response_at не
-- проставлялся нигде, просрочку никто не замечал.
--
-- Что делает файл:
--   1. settings.working_hours — расписание отдела (по дням недели, праздники,
--      часовой пояс) с проверкой формы, чтобы мусор не сломал расчёт.
--   2. working_hours_config(), add_working_minutes(), working_minutes_between() —
--      арифметика рабочего времени.
--   3. set_sla_due(): срок считается в рабочих минутах; сделку, созданную
--      сотрудником вручную, считаем отвеченной сразу.
--   4. first_response_at проставляется базой, а не интерфейсом:
--        * исходящий звонок менеджера по контакту сделки (любая попытка — SLA
--          меряет реакцию, а не дозвон) и принятый входящий;
--        * исходящее сообщение сотрудника в инбоксе;
--        * перенос сделки менеджером с первого этапа или смена статуса
--          open → postponed/won/lost.
--      Взятие из котла ответом НЕ считается: иначе одна кнопка «Взять»
--      отключала бы SLA, а первого контакта с клиентом ещё не было.
--   5. process_sla_breaches() — эскалация; планировщик зовёт раз в 5 минут.
--   6. crm_board отдаёт в карточке sla_due_at и sla_left_min (рабочие минуты).
-- Старые импортированные сделки (amo_id) и сделки, появившиеся до применения
-- миграции, SLA не трекаются: отметка применения лежит в settings.sla_live_since.

-- 1. Настройки ------------------------------------------------------------------
-- Формат: days — ключи ISO-дней недели "1" (пн) … "7" (вс); значение null —
-- выходной, иначе {"start": "09:00", "end": "18:00"}. holidays — даты YYYY-MM-DD.
insert into public.settings (key, value) values
  ('working_hours', jsonb_build_object(
    'tz', 'Europe/Chisinau',
    'days', jsonb_build_object(
      '1', jsonb_build_object('start', '09:00', 'end', '18:00'),
      '2', jsonb_build_object('start', '09:00', 'end', '18:00'),
      '3', jsonb_build_object('start', '09:00', 'end', '18:00'),
      '4', jsonb_build_object('start', '09:00', 'end', '18:00'),
      '5', jsonb_build_object('start', '09:00', 'end', '18:00'),
      '6', null,
      '7', null),
    'holidays', '[]'::jsonb))
on conflict (key) do nothing;

-- Граница «живых» сделок: что пришло раньше, SLA не будит. Ставится один раз.
insert into public.settings (key, value)
values ('sla_live_since', to_jsonb(now()))
on conflict (key) do nothing;

-- Проверка формы при записи: админ получает понятную ошибку, а не молча
-- сломанный расчёт. Те же правила использует и интерфейс.
create or replace function public.validate_working_hours()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_tz  text;
  v_day text;
  v_cfg jsonb;
  v_h   text;
  v_s   time;
  v_e   time;
begin
  if new.key = 'sla_first_response' then
    if jsonb_typeof(new.value) <> 'object'
       or jsonb_typeof(new.value -> 'minutes') <> 'number'
       or (new.value ->> 'minutes')::numeric <> trunc((new.value ->> 'minutes')::numeric)
       or (new.value ->> 'minutes')::numeric not between 1 and 10080 then
      raise exception 'Срок первого ответа — целое число минут от 1 до 10080'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.key <> 'working_hours' then
    return new;
  end if;
  v_cfg := new.value;
  if jsonb_typeof(v_cfg) <> 'object' or jsonb_typeof(v_cfg -> 'days') <> 'object' then
    raise exception 'Рабочие часы: ожидается объект с расписанием по дням'
      using errcode = 'check_violation';
  end if;

  v_tz := coalesce(v_cfg ->> 'tz', 'Europe/Chisinau');
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Рабочие часы: неизвестный часовой пояс %', v_tz
      using errcode = 'check_violation';
  end if;

  for v_day in select jsonb_object_keys(v_cfg -> 'days') loop
    if v_day not in ('1', '2', '3', '4', '5', '6', '7') then
      raise exception 'Рабочие часы: неизвестный день недели %', v_day
        using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_cfg -> 'days' -> v_day) = 'null' then
      continue;
    end if;
    begin
      v_s := (v_cfg -> 'days' -> v_day ->> 'start')::time;
      v_e := (v_cfg -> 'days' -> v_day ->> 'end')::time;
    exception when others then
      raise exception 'Рабочие часы: время дня % задано неверно', v_day
        using errcode = 'check_violation';
    end;
    if v_s is null or v_e is null or v_e <= v_s then
      raise exception 'Рабочие часы: конец рабочего дня должен быть позже начала (день %)', v_day
        using errcode = 'check_violation';
    end if;
  end loop;

  if v_cfg ? 'holidays' then
    if jsonb_typeof(v_cfg -> 'holidays') <> 'array' then
      raise exception 'Рабочие часы: праздники должны быть списком дат'
        using errcode = 'check_violation';
    end if;
    for v_h in select jsonb_array_elements_text(v_cfg -> 'holidays') loop
      begin
        perform v_h::date;
      exception when others then
        raise exception 'Рабочие часы: дата праздника % не распознана', v_h
          using errcode = 'check_violation';
      end;
    end loop;
  end if;
  return new;
end;
$fn$;

drop trigger if exists settings_validate_working_hours on public.settings;
create trigger settings_validate_working_hours
  before insert or update on public.settings
  for each row execute function public.validate_working_hours();

-- 2. Арифметика рабочего времени --------------------------------------------------
-- Настройка с запасным значением (пн–пт 09–18) на случай, если строки нет.
create or replace function public.working_hours_config()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select s.value from public.settings s
      where s.key = 'working_hours' and jsonb_typeof(s.value -> 'days') = 'object'),
    jsonb_build_object(
      'tz', 'Europe/Chisinau',
      'days', jsonb_build_object(
        '1', jsonb_build_object('start', '09:00', 'end', '18:00'),
        '2', jsonb_build_object('start', '09:00', 'end', '18:00'),
        '3', jsonb_build_object('start', '09:00', 'end', '18:00'),
        '4', jsonb_build_object('start', '09:00', 'end', '18:00'),
        '5', jsonb_build_object('start', '09:00', 'end', '18:00')),
      'holidays', '[]'::jsonb));
$fn$;

-- Рабочий интервал местного дня: (начало, конец) или null, если день выходной.
create or replace function public.working_day_bounds(p_cfg jsonb, p_day date)
returns table (day_start timestamp, day_end timestamp)
language plpgsql immutable
set search_path = public, pg_temp
as $fn$
declare
  v_slot jsonb := p_cfg -> 'days' -> extract(isodow from p_day)::int::text;
  v_s time;
  v_e time;
begin
  if v_slot is null or jsonb_typeof(v_slot) <> 'object' then
    return;
  end if;
  if (p_cfg -> 'holidays') ? to_char(p_day, 'YYYY-MM-DD') then
    return;
  end if;
  v_s := (v_slot ->> 'start')::time;
  v_e := (v_slot ->> 'end')::time;
  if v_s is null or v_e is null or v_e <= v_s then
    return;
  end if;
  day_start := p_day + v_s;
  day_end := p_day + v_e;
  return next;
end;
$fn$;

-- Момент через p_minutes рабочих минут после p_from. Если p_from вне рабочего
-- времени, отсчёт идёт от начала ближайшего рабочего интервала. Нет ни одного
-- рабочего дня в настройке — считаем календарно, чтобы SLA не пропал.
create or replace function public.add_working_minutes(p_from timestamptz, p_minutes integer)
returns timestamptz
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg    jsonb := public.working_hours_config();
  v_tz     text  := coalesce(v_cfg ->> 'tz', 'Europe/Chisinau');
  v_local  timestamp;
  v_day    date;
  v_left   integer;
  v_from   timestamp;
  v_avail  integer;
  b        record;
  v_guard  integer := 0;
begin
  if p_from is null or p_minutes is null then
    return null;
  end if;
  v_left  := greatest(p_minutes, 0);
  v_local := p_from at time zone v_tz;
  v_day   := v_local::date;

  while v_guard < 800 loop
    select * into b from public.working_day_bounds(v_cfg, v_day);
    if b.day_start is not null and v_local < b.day_end then
      v_from  := greatest(v_local, b.day_start);
      v_avail := floor(extract(epoch from (b.day_end - v_from)) / 60)::int;
      if v_left <= v_avail then
        return (v_from + make_interval(mins => v_left)) at time zone v_tz;
      end if;
      v_left := v_left - v_avail;
    end if;
    v_day   := v_day + 1;
    v_local := v_day::timestamp;
    v_guard := v_guard + 1;
  end loop;

  return p_from + make_interval(mins => greatest(p_minutes, 0));
end;
$fn$;

-- Сколько рабочих минут между двумя моментами; отрицательное, если p_to < p_from.
create or replace function public.working_minutes_between(p_from timestamptz, p_to timestamptz)
returns integer
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg   jsonb := public.working_hours_config();
  v_tz    text  := coalesce(v_cfg ->> 'tz', 'Europe/Chisinau');
  v_a     timestamp;
  v_b     timestamp;
  v_day   date;
  v_last  date;
  v_sum   numeric := 0;
  v_lo    timestamp;
  v_hi    timestamp;
  b       record;
begin
  if p_from is null or p_to is null then
    return null;
  end if;
  if p_to < p_from then
    return -public.working_minutes_between(p_to, p_from);
  end if;
  v_a := p_from at time zone v_tz;
  v_b := p_to at time zone v_tz;
  v_day  := v_a::date;
  v_last := v_b::date;
  -- Страховка от абсурдных диапазонов (импорт с датами из прошлого века).
  if v_last - v_day > 800 then
    v_day := v_last - 800;
  end if;
  while v_day <= v_last loop
    select * into b from public.working_day_bounds(v_cfg, v_day);
    if b.day_start is not null then
      v_lo := greatest(v_a, b.day_start);
      v_hi := least(v_b, b.day_end);
      if v_hi > v_lo then
        v_sum := v_sum + extract(epoch from (v_hi - v_lo)) / 60;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return floor(v_sum)::int;
end;
$fn$;

revoke all on function public.working_hours_config() from public, anon;
revoke all on function public.working_day_bounds(jsonb, date) from public, anon;
revoke all on function public.add_working_minutes(timestamptz, integer) from public, anon;
revoke all on function public.working_minutes_between(timestamptz, timestamptz) from public, anon;
grant execute on function public.working_hours_config() to authenticated, service_role;
grant execute on function public.working_day_bounds(jsonb, date) to authenticated, service_role;
grant execute on function public.add_working_minutes(timestamptz, integer) to authenticated, service_role;
grant execute on function public.working_minutes_between(timestamptz, timestamptz) to authenticated, service_role;

-- 3. Срок первого ответа в рабочем времени -----------------------------------------
create or replace function public.set_sla_due()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_minutes integer;
begin
  -- Импорт amoCRM живёт по своим датам и SLA не трекается.
  if new.amo_id is not null then
    return new;
  end if;

  if new.first_inbound_at is null then
    new.first_inbound_at := now();
  end if;

  select coalesce((value ->> 'minutes')::int, 30) into v_minutes
    from public.settings where key = 'sla_first_response';

  new.sla_due_at := public.add_working_minutes(new.first_inbound_at, coalesce(v_minutes, 30));

  -- Сделку завёл сам сотрудник (кнопка «Новая сделка»): контакт с клиентом уже
  -- был, ждать первого ответа не от кого.
  if new.created_by is not null and new.first_response_at is null then
    new.first_response_at := new.first_inbound_at;
  end if;
  return new;
end;
$fn$;

-- 4. first_response_at ---------------------------------------------------------------
-- 4a. Перенос с первого этапа и смена статуса менеджером.
create or replace function public.deals_mark_first_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.amo_id is not null
     or new.first_response_at is not null
     or auth.uid() is null then
    return new;
  end if;

  if (new.stage_id is distinct from old.stage_id
      and exists (
        select 1 from public.stages s
         where s.id = old.stage_id
           and s.position = (select min(s2.position) from public.stages s2 where s2.is_active)))
     or (new.status is distinct from old.status and old.status = 'open') then
    new.first_response_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists deals_mark_first_response on public.deals;
create trigger deals_mark_first_response
  before update of stage_id, status on public.deals
  for each row execute function public.deals_mark_first_response();

-- 4b. Звонки сотрудника.
create or replace function public.calls_mark_first_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_at timestamptz := coalesce(new.started_at, now());
begin
  if new.user_id is null or new.contact_id is null then
    return new;
  end if;
  if not (new.direction = 'out' or (new.direction = 'in' and new.status = 'success')) then
    return new;
  end if;

  update public.deals d
     set first_response_at = greatest(v_at, d.first_inbound_at)
   where d.amo_id is null
     and d.first_response_at is null
     and d.deleted_at is null
     and d.first_inbound_at <= v_at
     and ((new.deal_id is not null and d.id = new.deal_id)
          or (new.deal_id is null and d.contact_id = new.contact_id));
  return new;
exception when others then
  -- Сбой отметки не должен ронять запись звонка от АТС.
  raise warning 'calls_mark_first_response: %', sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists calls_mark_first_response on public.calls;
create trigger calls_mark_first_response
  after insert or update of user_id, direction, status on public.calls
  for each row execute function public.calls_mark_first_response();

-- 4c. Исходящие сообщения сотрудника в инбоксе.
create or replace function public.messages_mark_first_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_contact uuid;
begin
  if new.direction <> 'out' or new.author_user_id is null then
    return new;
  end if;
  select c.contact_id into v_contact
    from public.conversations c where c.id = new.conversation_id;
  if v_contact is null then
    return new;
  end if;

  update public.deals d
     set first_response_at = greatest(new.sent_at, d.first_inbound_at)
   where d.contact_id = v_contact
     and d.amo_id is null
     and d.first_response_at is null
     and d.deleted_at is null
     and d.first_inbound_at <= new.sent_at;
  return new;
exception when others then
  raise warning 'messages_mark_first_response: %', sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists messages_mark_first_response on public.messages;
create trigger messages_mark_first_response
  after insert on public.messages
  for each row execute function public.messages_mark_first_response();

revoke all on function public.deals_mark_first_response() from public, anon, authenticated;
revoke all on function public.calls_mark_first_response() from public, anon, authenticated;
revoke all on function public.messages_mark_first_response() from public, anon, authenticated;

-- 5. Эскалация -------------------------------------------------------------------------
-- Зовётся планировщиком раз в 5 минут. Повторный вызов ничего не дублирует:
-- сделку помечает один UPDATE с условием sla_breached_at is null, уведомления
-- рождаются из его RETURNING.
create or replace function public.process_sla_breaches()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_since   timestamptz;
  v_minutes integer;
  v_count   integer := 0;
  v_notify  boolean;
begin
  select (s.value #>> '{}')::timestamptz into v_since
    from public.settings s where s.key = 'sla_live_since';
  if v_since is null then
    return 0;
  end if;
  select coalesce((s.value ->> 'minutes')::int, 30) into v_minutes
    from public.settings s where s.key = 'sla_first_response';
  v_notify := public.notification_in_app_enabled('sla_breach');

  with breached as (
    update public.deals d
       set sla_breached_at = now()
     where d.sla_breached_at is null
       and d.first_response_at is null
       and d.sla_due_at < now()
       and d.amo_id is null
       and d.deleted_at is null
       and d.status = 'open'
       and d.first_inbound_at >= v_since
    returning d.id, d.contact_id, d.owner_id, d.sla_due_at
  ),
  ins as (
    insert into public.notifications (user_id, kind, title, body, deal_id, contact_id, payload)
    select u.user_id,
           'sla_breach',
           'Просрочен первый ответ: ' || coalesce(nullif(c.full_name, ''), 'без имени'),
           'Срок был до '
             || to_char(b.sla_due_at at time zone 'Europe/Chisinau', 'DD.MM HH24:MI')
             || ' (' || coalesce(v_minutes, 30) || ' мин рабочего времени). '
             || case when b.owner_id is null
                     then 'Сделка в общем котле.'
                     else 'Ответственный: ' || coalesce(o.full_name, 'не указан') || '.'
                end,
           b.id,
           b.contact_id,
           jsonb_build_object('deal_id', b.id, 'sla_due_at', b.sla_due_at)
      from breached b
      left join public.contacts c on c.id = b.contact_id
      left join public.profiles o on o.id = b.owner_id
      cross join lateral (
        -- Адресаты — по правилам sla_breach; без правил: ответственный и руководители.
        select distinct p.id as user_id
          from public.profiles p
         where p.is_active
           and (
             (b.owner_id is not null and p.id = b.owner_id
               and coalesce((select bool_or(r.notify_owner)
                               from public.notification_rules r
                              where r.kind = 'sla_breach' and r.is_active and r.in_app), true))
             or p.role = any (
               case when exists (select 1 from public.notification_rules r
                                  where r.kind = 'sla_breach' and r.is_active and r.in_app)
                    then coalesce(
                           (select array_agg(r.notify_role)
                              from public.notification_rules r
                             where r.kind = 'sla_breach' and r.is_active and r.in_app
                               and r.notify_role is not null),
                           '{}'::public.user_role[])
                    else array['head']::public.user_role[]
               end)
           )
      ) u
     where v_notify
    returning 1
  )
  select count(*) into v_count from breached;

  return v_count;
end;
$fn$;

revoke all on function public.process_sla_breaches() from public, anon, authenticated;
grant execute on function public.process_sla_breaches() to service_role, postgres;

-- 6. Доска: SLA в карточке ----------------------------------------------------------------
-- Тело — из ветки 20261006200000_qa_f_crm_board_filters.sql с тремя вставками,
-- помеченными «-- SLA».
drop function if exists public.crm_board(integer, integer, uuid, uuid, uuid, uuid, text, text, uuid[], date, date, text);

CREATE FUNCTION public.crm_board(p_page integer DEFAULT 0, p_page_size integer DEFAULT 24, p_owner uuid DEFAULT NULL::uuid, p_project uuid DEFAULT NULL::uuid, p_tag uuid DEFAULT NULL::uuid, p_source uuid DEFAULT NULL::uuid, p_flag text DEFAULT NULL::text, p_sort text DEFAULT 'updated'::text,
  p_tags uuid[] DEFAULT NULL::uuid[], p_created_from date DEFAULT NULL::date,
  p_created_to date DEFAULT NULL::date, p_column text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
return (
with visible as materialized (
  select d.id, d.contact_id, d.owner_id, d.stage_id, d.status, d.title, d.object_text,
         d.source_id, d.budget, d.budget_currency, d.down_payment_text,
         d.monthly_payment_text, d.postponed_until, d.updated_at, d.created_at,
         -- SLA: только живая открытая сделка без первого ответа.
         d.sla_due_at,
         (d.amo_id is null and d.first_response_at is null and d.sla_due_at is not null
          and d.status = 'open'
          and d.first_inbound_at >= coalesce(
                (select (s.value #>> '{}')::timestamptz from settings s where s.key = 'sla_live_since'),
                'infinity'::timestamptz)) as sla_tracked
  from deals d
  where d.deleted_at is null
    and (p_owner   is null or d.owner_id  = p_owner)
    and (p_source  is null or d.source_id = p_source)
    and (p_project is null or exists (
          select 1 from deal_projects dp
          where dp.deal_id = d.id and dp.project_id = p_project))
    and (p_tag is null or exists (
          select 1 from deal_tags dt
          where dt.deal_id = d.id and dt.tag_id = p_tag))
    -- Несколько меток: подходит сделка хотя бы с одной из выбранных.
    and (p_tags is null or cardinality(p_tags) = 0 or exists (
          select 1 from deal_tags dt
          where dt.deal_id = d.id and dt.tag_id = any (p_tags)))
    -- Дата создания по часовому поясу отдела, границы включительно.
    and (p_created_from is null
         or d.created_at >= (p_created_from::timestamp at time zone 'Europe/Chisinau'))
    and (p_created_to is null
         or d.created_at <  ((p_created_to + 1)::timestamp at time zone 'Europe/Chisinau'))
    and (
      p_flag is null
      or (p_flag = 'no_next_step' and d.status = 'open' and not exists (
            select 1 from tasks t where t.deal_id = d.id and t.done_at is null))
      or (p_flag = 'overdue' and exists (
            select 1 from tasks t
            where t.deal_id = d.id and t.done_at is null and t.due_at < now()))
      or (p_flag = 'today' and exists (
            select 1 from tasks t
            where t.deal_id = d.id and t.done_at is null
              and t.due_at >= date_trunc('day', now())
              and t.due_at <  date_trunc('day', now()) + interval '1 day'))
    )
),
ranked as materialized (
  select
    v.*,
    k.column_key,
    count(*)      over (partition by k.column_key) as column_total,
    sum(v.budget) over (partition by k.column_key) as column_sum,
    row_number() over (
      partition by k.column_key
      order by
        case when p_sort = 'budget'  then v.budget     end desc nulls last,
        case when p_sort = 'created' then v.created_at end desc nulls last,
        case when p_sort = 'contact'
             then (select c.full_name from contacts c where c.id = v.contact_id)
        end asc nulls last,
        v.updated_at desc,
        v.id
    ) as rn
  from visible v
  cross join lateral (select case
      when v.owner_id is null and v.status not in ('won', 'lost') then 'kettle'
      else v.stage_id::text
    end as column_key) k
),
page as (
  select * from ranked
  where rn >  p_page * p_page_size
    and rn <= (p_page + 1) * p_page_size
    -- Подгрузка прокруткой просит страницу одной колонки, а не всей доски.
    and (p_column is null or column_key = p_column)
),
cards as (
  select
    r.column_key,
    r.rn,
    jsonb_build_object(
      'id',                 r.id,
      'contact_id',         r.contact_id,
      'contact_name',       contact.full_name,
      'owner_id',           r.owner_id,
      'owner_name',         owner.full_name,
      'stage_id',           r.stage_id,
      'status',             r.status,
      'title',              r.title,
      'object_text',        r.object_text,
      'source_name',        source.name,
      'budget',             r.budget,
      'budget_currency',    r.budget_currency,
      'down_payment_text',  r.down_payment_text,
      'monthly_payment_text', r.monthly_payment_text,
      'postponed_until',    r.postponed_until,
      'updated_at',         r.updated_at,
      'created_at',         r.created_at,
      'phone',              phone.phone,
      'tags',               coalesce(tags.list,     '[]'::jsonb),
      'projects',           coalesce(projects.list, '[]'::jsonb),
      'next_task',          next_task.card,
      'last_activity',      activity.card,
      -- SLA: срок и остаток в рабочих минутах (минус — просрочено).
      'sla_due_at',         case when r.sla_tracked then r.sla_due_at end,
      'sla_left_min',       case when r.sla_tracked then
                              case when r.sla_due_at >= now()
                                   then public.working_minutes_between(now(), r.sla_due_at)
                                   else -public.working_minutes_between(r.sla_due_at, now())
                              end
                            end
    ) as card
  from page r
    left join lateral (
      select c.full_name from contacts c where c.id = r.contact_id
    ) contact on true
    left join lateral (
      select pr.full_name from profiles pr where pr.id = r.owner_id
    ) owner on true
    left join lateral (
      select s.name from sources s where s.id = r.source_id
    ) source on true
    left join lateral (
      select cp.phone from contact_phones cp
      where cp.contact_id = r.contact_id
      order by cp.is_primary desc nulls last
      limit 1
    ) phone on true
    left join lateral (
      -- Сначала метки этой сделки, потом их имена: иначе планировщик шёл по всем
      -- 53 меткам и на каждую искал связь — 30 тыс. обращений на страницу доски.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) as list
      from (select dt.tag_id from deal_tags dt where dt.deal_id = r.id offset 0) dt
      join tags t on t.id = dt.tag_id
    ) tags on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', p2.id, 'code', p2.code, 'name', p2.name)
                       order by p2.position) as list
      from deal_projects dp join projects p2 on p2.id = dp.project_id
      where dp.deal_id = r.id
    ) projects on true
    left join lateral (
      select jsonb_build_object('title', t.title, 'due_at', t.due_at) as card
      from tasks t
      where t.deal_id = r.id and t.done_at is null
      order by t.due_at
      limit 1
    ) next_task on true
    left join lateral (
      select jsonb_build_object('kind', a.kind, 'text', a.text, 'at', a.at) as card
      from (
        select 'note' as kind, left(n.body, 120) as text, n.created_at as at
        from notes n
        where n.deal_id = r.id and n.deleted_at is null
          -- Импорт завёл по заметке-двойнику на каждый звонок («Исходящий звонок»).
          and (n.amo_note_type is null or n.amo_note_type not in ('call_in', 'call_out'))
        union all
        select 'call', coalesce(c2.direction::text, 'звонок'), c2.started_at
        from calls c2 where c2.deal_id = r.id
        union all
        select 'stage', null, st.changed_at
        from stage_transitions st where st.deal_id = r.id
        union all
        select 'created', null, r.created_at
      ) a
      -- Заметка и звонок выше смены этапа и создания независимо от свежести.
      order by (case when a.kind in ('note', 'call') then 0 else 1 end),
               a.at desc nulls last
      limit 1
    ) activity on true
),
card_lists as (
  select column_key, jsonb_agg(card order by rn) as deals
  from cards
  group by column_key
),
columns as (
  select
    r.column_key,
    max(r.column_total) as total,
    max(r.column_sum)   as sum
  from ranked r
  group by r.column_key
),
open_tasks as (
  -- Флаги открытых задач одним проходом по задачам, а не три EXISTS на сделку.
  select
    t.deal_id,
    bool_or(t.due_at < now()) as overdue,
    bool_or(t.due_at >= date_trunc('day', now())
            and t.due_at < date_trunc('day', now()) + interval '1 day') as today
  from tasks t
  where t.done_at is null and t.deal_id is not null
  group by t.deal_id
),
counters as (
  select
    count(*) filter (where v.status = 'open' and ot.deal_id is null) as no_next_step,
    count(*) filter (where ot.overdue)                               as overdue,
    count(*) filter (where ot.today)                                 as today
  from visible v
  left join open_tasks ot on ot.deal_id = v.id
)
select jsonb_build_object(
  'columns', (
    select coalesce(jsonb_object_agg(
      c.column_key,
      jsonb_build_object(
        'total', c.total,
        'sum',   c.sum,
        'deals', coalesce(cl.deals, '[]'::jsonb)
      )
    ), '{}'::jsonb)
    from columns c
    left join card_lists cl on cl.column_key = c.column_key
  ),
  'counters', (select to_jsonb(counters) from counters),
  'total',    (select count(*) from visible)
));
end;
$function$;

revoke all on function public.crm_board(integer, integer, uuid, uuid, uuid, uuid, text, text, uuid[], date, date, text) from public, anon;
grant execute on function public.crm_board(integer, integer, uuid, uuid, uuid, uuid, text, text, uuid[], date, date, text) to authenticated, service_role;
