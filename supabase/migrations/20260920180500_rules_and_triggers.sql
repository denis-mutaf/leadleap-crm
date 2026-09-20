-- Дисциплина воронки живёт в базе, а не в кнопках интерфейса:
-- обойти её через API или чужой клиент нельзя.

create or replace function current_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- Обновление updated_at
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger deals_touch before update on deals
  for each row execute function touch_updated_at();
create or replace trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();

-- Гейты перехода: квалификация и следующий шаг.
create or replace function enforce_stage_gates()
returns trigger
language plpgsql
as $$
declare
  old_position smallint;
  new_stage    stages%rowtype;
  missing      text[] := '{}';
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select * into new_stage from stages where id = new.stage_id;
  select position into old_position from stages where id = old.stage_id;

  -- назад по воронке и в закрывающие этапы пускаем без гейтов:
  -- менеджер должен иметь право откатить ошибку и закрыть безнадёжную сделку
  if new_stage.position <= old_position or new_stage.kind <> 'open' then
    return new;
  end if;

  if new_stage.requires_qualification then
    if new.budget is null then missing := array_append(missing, 'бюджет'); end if;
    if new.payment is null then missing := array_append(missing, 'способ оплаты'); end if;
    if new.horizon is null then missing := array_append(missing, 'срок покупки'); end if;
    if new.residency is null then missing := array_append(missing, 'диаспора или местный'); end if;
    if new.rooms is null then missing := array_append(missing, 'комнатность'); end if;
    if new.purpose is null then missing := array_append(missing, 'цель покупки'); end if;

    if array_length(missing, 1) > 0 then
      raise exception 'Не заполнена квалификация: %', array_to_string(missing, ', ')
        using errcode = 'check_violation';
    end if;
  end if;

  if new_stage.requires_next_step then
    if not exists (
      select 1 from tasks
      where deal_id = new.id
        and done_at is null
        and due_at is not null
    ) then
      raise exception 'Нет следующего шага: поставьте задачу с конкретной датой, иначе сделка дальше не идёт'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger deals_stage_gates before update on deals
  for each row execute function enforce_stage_gates();

-- Этап закрытия сам выставляет статус сделки: выигран или проигран.
create or replace function sync_status_with_stage()
returns trigger
language plpgsql
as $$
declare
  kind stage_kind;
begin
  select s.kind into kind from stages s where s.id = new.stage_id;

  if kind = 'won' then
    new.status := 'won';
  elsif kind = 'lost' then
    new.status := 'lost';
  elsif new.status in ('won', 'lost') then
    -- вернули из закрытого этапа в работу
    new.status := 'open';
  end if;

  return new;
end;
$$;

create or replace trigger deals_sync_status before insert or update of stage_id on deals
  for each row execute function sync_status_with_stage();

-- История переходов пишется автоматически: забыть её нельзя.
create or replace function record_stage_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into stage_transitions (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
    values (new.id, null, new.stage_id, null, new.status, current_profile_id());
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id or new.status is distinct from old.status then
    insert into stage_transitions (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
    values (new.id, old.stage_id, new.stage_id, old.status, new.status, current_profile_id());
  end if;

  return new;
end;
$$;

create or replace trigger deals_record_transition after insert or update on deals
  for each row execute function record_stage_transition();

-- SLA первого ответа считается от появления обращения.
create or replace function set_sla_due()
returns trigger
language plpgsql
as $$
declare
  minutes integer;
begin
  if new.first_inbound_at is null then
    new.first_inbound_at := now();
  end if;

  select coalesce((value ->> 'minutes')::int, 30) into minutes
  from settings where key = 'sla_first_response';

  new.sla_due_at := new.first_inbound_at + make_interval(mins => coalesce(minutes, 30));
  return new;
end;
$$;

create or replace trigger deals_set_sla before insert on deals
  for each row execute function set_sla_due();

-- Дата касания по отложенной сделке рождает задачу ответственному.
create or replace function create_touch_task()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'postponed'
     and new.postponed_until is not null
     and new.owner_id is not null
     and (old.status is distinct from 'postponed' or old.postponed_until is distinct from new.postponed_until)
  then
    insert into tasks (deal_id, contact_id, assignee_id, title, due_at, is_auto, created_by)
    values (
      new.id,
      new.contact_id,
      new.owner_id,
      'Касание по отложенной сделке',
      new.postponed_until::timestamptz,
      true,
      current_profile_id()
    );
  end if;

  return new;
end;
$$;

create or replace trigger deals_touch_task after update on deals
  for each row execute function create_touch_task();

-- Лог изменений: одна строка на действие, с разницей значений.
create or replace function write_audit()
returns trigger
language plpgsql
as $$
declare
  diff jsonb := '{}'::jsonb;
  k    text;
  old_j jsonb;
  new_j jsonb;
begin
  if tg_op = 'DELETE' then
    insert into audit_log (entity, entity_id, action, changes, actor_id)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), current_profile_id());
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into audit_log (entity, entity_id, action, changes, actor_id)
    values (tg_table_name, new.id, 'insert', to_jsonb(new), current_profile_id());
    return new;
  end if;

  old_j := to_jsonb(old);
  new_j := to_jsonb(new);

  for k in select jsonb_object_keys(new_j) loop
    if new_j -> k is distinct from old_j -> k and k not in ('updated_at') then
      diff := diff || jsonb_build_object(k, jsonb_build_object('was', old_j -> k, 'now', new_j -> k));
    end if;
  end loop;

  if diff <> '{}'::jsonb then
    insert into audit_log (entity, entity_id, action, changes, actor_id)
    values (tg_table_name, new.id, 'update', diff, current_profile_id());
  end if;

  return new;
end;
$$;

create or replace trigger deals_audit after insert or update or delete on deals
  for each row execute function write_audit();
create or replace trigger contacts_audit after insert or update or delete on contacts
  for each row execute function write_audit();
create or replace trigger tasks_audit after insert or update or delete on tasks
  for each row execute function write_audit();

-- Сотрудник появляется в profiles в момент заведения в auth.users:
-- без этой строки приложение не пустит его дальше входа.
-- Имя и роль берутся из user metadata приглашения; дефолт — менеджер.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    coalesce((nullif(new.raw_user_meta_data ->> 'role', ''))::user_role, 'manager')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
