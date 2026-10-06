-- QA B-10, B-11, тикет 54: серверная половина карточки сделки.
--   1. Лента изменений: audit_log дополняется метками, проектом и пользовательскими
--      полями; менеджер читает ленту своей сделки через deal_change_feed (сам
--      audit_log видят только руководитель и админ).
--   2. Проект сделки — одиночный выбор: set_deal_project.
--   3. Валидация чисел и справочников карточки (только для правок людьми:
--      импорт и миграции идут без auth.uid() и не блокируются).
--   4. Пометка «изменено» у примечаний: notes.edited_at.
-- Применять до выкладки клиента: карточка читает notes.edited_at и вызывает RPC.

-- ───────────────────────── 4. «изменено» у примечаний ─────────────────────────
alter table public.notes add column if not exists edited_at timestamptz;

create or replace function public.mark_note_edited()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.body is distinct from old.body and auth.uid() is not null then
    new.edited_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists notes_mark_edited on public.notes;
create trigger notes_mark_edited
  before update of body on public.notes
  for each row execute function public.mark_note_edited();

-- ───────────────────────── 3. валидация карточки ─────────────────────────
-- Платёж и взнос: число, диапазон «1000-1500», «до 1000», «от 2500», процент
-- или «всё сразу». Пробелы, знак € и тире разных видов не мешают.
create or replace function public.crm_amount_text_ok(p text)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
  t text := btrim(coalesce(p, ''));
  parts text[];
begin
  if t = '' then return true; end if;
  t := lower(regexp_replace(t, '[[:space:]€]|eur', '', 'gi'));
  t := replace(replace(replace(t, '–', '-'), '—', '-'), ',', '.');
  if t ~ '^\d{1,3}%$' then return replace(t, '%', '')::int <= 100; end if;
  if t in ('всёсразу', 'всесразу') then return true; end if;
  if t ~ '^(до|от)?\d+(\.\d+)?$' then return true; end if;
  if t ~ '^\d+(\.\d+)?-\d+(\.\d+)?$' then
    parts := string_to_array(t, '-');
    return parts[1]::numeric <= parts[2]::numeric;
  end if;
  return false;
end;
$function$;

-- Этаж и площадь: неотрицательное число или диапазон; «м²» не мешает.
create or replace function public.crm_size_text_ok(p text)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
  t text := btrim(coalesce(p, ''));
  parts text[];
begin
  if t = '' then return true; end if;
  t := lower(regexp_replace(t, '[[:space:]]|м²|м2|m2|кв\.?м', '', 'gi'));
  t := replace(replace(replace(t, '–', '-'), '—', '-'), ',', '.');
  if t ~ '^\d+(\.\d+)?$' then return true; end if;
  if t ~ '^\d+(\.\d+)?-\d+(\.\d+)?$' then
    parts := string_to_array(t, '-');
    return parts[1]::numeric <= parts[2]::numeric;
  end if;
  return false;
end;
$function$;

create or replace function public.validate_deal_user_input()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  fresh boolean := tg_op = 'INSERT';
begin
  -- Импорт, миграции и сервисные задачи приходят без пользователя: им верим.
  if auth.uid() is null then return new; end if;

  if (fresh or new.budget is distinct from old.budget) and new.budget is not null and new.budget < 0 then
    raise exception 'Бюджет не может быть отрицательным' using errcode = 'check_violation';
  end if;
  if (fresh or new.rooms is distinct from old.rooms) and new.rooms is not null and new.rooms not between 1 and 4 then
    raise exception 'Комнатность — выберите из списка: 1, 2, 3 или 4 и больше' using errcode = 'check_violation';
  end if;
  if (fresh or new.monthly_payment_text is distinct from old.monthly_payment_text)
     and not public.crm_amount_text_ok(new.monthly_payment_text) then
    raise exception 'Ежемесячный платёж — число или диапазон, например 800 или 800-1200' using errcode = 'check_violation';
  end if;
  if (fresh or new.down_payment_text is distinct from old.down_payment_text)
     and not public.crm_amount_text_ok(new.down_payment_text) then
    raise exception 'Первый взнос — число или диапазон, например 10000 или 10000-20000' using errcode = 'check_violation';
  end if;
  if (fresh or new.purchase_timing_text is distinct from old.purchase_timing_text)
     and nullif(btrim(new.purchase_timing_text), '') is not null
     and btrim(new.purchase_timing_text) !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Срок покупки — выберите месяц' using errcode = 'check_violation';
  end if;
  if (fresh or new.residency_detail is distinct from old.residency_detail)
     and nullif(btrim(new.residency_detail), '') is not null then
    raise exception 'В стране — выберите «Местный» или «Диаспора»' using errcode = 'check_violation';
  end if;
  if (fresh or new.desired_floor_text is distinct from old.desired_floor_text)
     and not public.crm_size_text_ok(new.desired_floor_text) then
    raise exception 'Этаж — неотрицательное число или диапазон, например 3-5' using errcode = 'check_violation';
  end if;
  if (fresh or new.desired_area_text is distinct from old.desired_area_text)
     and not public.crm_size_text_ok(new.desired_area_text) then
    raise exception 'Площадь — неотрицательное число или диапазон, например 55-70' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists deals_validate_user_input on public.deals;
create trigger deals_validate_user_input
  before insert or update on public.deals
  for each row execute function public.validate_deal_user_input();

-- ───────────────────────── 1. лента изменений ─────────────────────────
-- Метки и проект живут в связующих таблицах и в audit_log сами не попадают.
-- Событие пишется как изменение сделки: {"tags": {"was": null, "now": "КВАЛ"}}.
create or replace function public.audit_deal_relation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_deal  uuid := case when tg_op = 'DELETE' then old.deal_id else new.deal_id end;
  v_key   text;
  v_was   text;
  v_now   text;
begin
  if v_actor is not null
     -- сделку только что завели в этой же транзакции — это не правка
     and not exists (select 1 from deals d where d.id = v_deal and d.created_at = now())
     -- сделки уже нет: каскад при очистке корзины
     and exists (select 1 from deals d where d.id = v_deal)
  then
    if tg_table_name = 'deal_tags' then
      v_key := 'tags';
      if tg_op <> 'INSERT' then select name into v_was from tags where id = old.tag_id; end if;
      if tg_op <> 'DELETE' then select name into v_now from tags where id = new.tag_id; end if;
    else
      v_key := 'project';
      if tg_op <> 'INSERT' then select name into v_was from projects where id = old.project_id; end if;
      if tg_op <> 'DELETE' then select name into v_now from projects where id = new.project_id; end if;
    end if;
    insert into audit_log (entity, entity_id, action, changes, actor_id)
    values ('deals', v_deal, 'update',
            jsonb_build_object(v_key, jsonb_build_object('was', to_jsonb(v_was), 'now', to_jsonb(v_now))),
            v_actor);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists deal_tags_audit on public.deal_tags;
create trigger deal_tags_audit
  after insert or update or delete on public.deal_tags
  for each row execute function public.audit_deal_relation();

drop trigger if exists deal_projects_audit on public.deal_projects;
create trigger deal_projects_audit
  after insert or update or delete on public.deal_projects
  for each row execute function public.audit_deal_relation();

-- Пользовательские поля сделки: ключ «custom:<название поля>».
create or replace function public.audit_custom_field_value()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_field uuid := case when tg_op = 'DELETE' then old.field_id else new.field_id end;
  v_entity uuid := case when tg_op = 'DELETE' then old.entity_id else new.entity_id end;
  def     record;
  v_was   text;
  v_now   text;
begin
  if v_actor is not null then
    select label, entity::text as entity, field_type::text as field_type, options into def
    from custom_field_defs where id = v_field;
    if found and def.entity = 'deal' then
      if tg_op <> 'INSERT' then v_was := old.value #>> '{}'; end if;
      if tg_op <> 'DELETE' then v_now := new.value #>> '{}'; end if;
      if def.field_type = 'select' and jsonb_typeof(def.options) = 'array' then
        select coalesce(max(o ->> 'label'), v_was) into v_was
        from jsonb_array_elements(def.options) o
        where jsonb_typeof(o) = 'object' and o ->> 'value' = v_was;
        select coalesce(max(o ->> 'label'), v_now) into v_now
        from jsonb_array_elements(def.options) o
        where jsonb_typeof(o) = 'object' and o ->> 'value' = v_now;
      end if;
      if v_was is distinct from v_now then
        insert into audit_log (entity, entity_id, action, changes, actor_id)
        values ('deals', v_entity, 'update',
                jsonb_build_object('custom:' || def.label,
                  jsonb_build_object('was', to_jsonb(v_was), 'now', to_jsonb(v_now))),
                v_actor);
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists custom_field_values_audit on public.custom_field_values;
create trigger custom_field_values_audit
  after insert or update or delete on public.custom_field_values
  for each row execute function public.audit_custom_field_value();

-- Лента сделки для менеджера: audit_log закрыт RLS для всех, кроме руководителя
-- и админа, поэтому отдаём срез через функцию с проверкой видимости сделки.
-- Имена людей, источников и причин отказа — одним словарём id → имя.
create or replace function public.deal_change_feed(p_deal_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_keys constant text[] := array[
    'owner_id', 'source_id', 'title', 'object_text', 'budget', 'budget_currency',
    'payment', 'horizon', 'residency', 'rooms', 'purpose', 'postponed_until',
    'lost_reason_id', 'lost_comment', 'construction_stage', 'down_payment_text',
    'monthly_payment_text', 'purchase_timing_text', 'residency_detail',
    'desired_area_text', 'desired_floor_text', 'wishes', 'rooms_text',
    'tags', 'project'];
  v_events jsonb;
  v_names  jsonb;
begin
  if not public.can_see_deal(p_deal_id) then
    raise exception 'Deal unavailable' using errcode = '42501';
  end if;

  with ev as (
    select a.id, a.created_at, a.actor_id, a.changes
    from audit_log a
    where a.entity = 'deals' and a.entity_id = p_deal_id and a.action = 'update'
      and exists (
        select 1 from jsonb_object_keys(a.changes) k
        where k = any (v_keys) or k like 'custom:%')
    order by a.created_at desc
    limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'at', ev.created_at, 'actor_id', ev.actor_id, 'changes', ev.changes)
         order by ev.created_at desc), '[]'::jsonb)
  into v_events
  from ev;

  with ids as (
    select distinct x.v
    from jsonb_array_elements(v_events) e,
         lateral (values
           (e ->> 'actor_id'),
           (e -> 'changes' -> 'owner_id' ->> 'was'), (e -> 'changes' -> 'owner_id' ->> 'now'),
           (e -> 'changes' -> 'source_id' ->> 'was'), (e -> 'changes' -> 'source_id' ->> 'now'),
           (e -> 'changes' -> 'lost_reason_id' ->> 'was'), (e -> 'changes' -> 'lost_reason_id' ->> 'now')
         ) x(v)
    where x.v is not null
  )
  select coalesce(jsonb_object_agg(n.id, n.name), '{}'::jsonb)
  into v_names
  from (
    select p.id::text as id, p.full_name as name from profiles p where p.id::text in (select v from ids)
    union all
    select s.id::text, s.name from sources s where s.id::text in (select v from ids)
    union all
    select r.id::text, r.name from lost_reasons r where r.id::text in (select v from ids)
  ) n;

  return jsonb_build_object('events', v_events, 'names', v_names);
end;
$function$;

revoke all on function public.deal_change_feed(uuid) from public, anon;
grant execute on function public.deal_change_feed(uuid) to authenticated;

-- ───────────────────────── 2. проект — одиночный выбор ─────────────────────────
-- Данные многопроектных сделок не трогаем (это делает тикет 51): при первой
-- правке «лишние» проекты снимаются, остаётся выбранный. security invoker —
-- права на сделку проверяет RLS связующей таблицы.
create or replace function public.set_deal_project(p_deal_id uuid, p_project_id uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current uuid[];
begin
  if p_project_id is not null and not exists (
    select 1 from projects where id = p_project_id and is_active
  ) then
    raise exception 'Invalid project selection' using errcode = '22023';
  end if;
  if not exists (select 1 from deals where id = p_deal_id) then
    raise exception 'Deal unavailable' using errcode = '42501';
  end if;

  select coalesce(array_agg(project_id order by project_id), '{}') into v_current
  from deal_projects where deal_id = p_deal_id;

  if p_project_id is null then
    delete from deal_projects where deal_id = p_deal_id;
  elsif p_project_id = any (v_current) then
    delete from deal_projects where deal_id = p_deal_id and project_id <> p_project_id;
  elsif cardinality(v_current) = 0 then
    insert into deal_projects (deal_id, project_id) values (p_deal_id, p_project_id);
  else
    delete from deal_projects where deal_id = p_deal_id and project_id <> v_current[1];
    update deal_projects set project_id = p_project_id
    where deal_id = p_deal_id and project_id = v_current[1];
  end if;
end;
$function$;

revoke all on function public.set_deal_project(uuid, uuid) from public, anon;
grant execute on function public.set_deal_project(uuid, uuid) to authenticated;
