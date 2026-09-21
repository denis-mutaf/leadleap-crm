-- Imported history belongs at its original timestamps, not at cutover time.
-- The normal triggers still run for every later human edit.
create or replace function public.record_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.amo_id is null then
      insert into stage_transitions
        (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
      values (new.id, null, new.stage_id, null, new.status, current_profile_id());
    end if;
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id
     or new.status is distinct from old.status then
    insert into stage_transitions
      (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by)
    values
      (new.id, old.stage_id, new.stage_id, old.status, new.status, current_profile_id());
  end if;
  return new;
end;
$$;

create or replace function public.set_sla_due()
returns trigger
language plpgsql
as $$
declare
  minutes integer;
begin
  if new.amo_id is not null then
    return new;
  end if;

  if new.first_inbound_at is null then
    new.first_inbound_at := now();
  end if;

  select coalesce((value ->> 'minutes')::int, 30) into minutes
  from settings where key = 'sla_first_response';

  new.sla_due_at := new.first_inbound_at
    + make_interval(mins => coalesce(minutes, 30));
  return new;
end;
$$;

create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  diff jsonb := '{}'::jsonb;
  k text;
  old_j jsonb;
  new_j jsonb;
begin
  if tg_op = 'DELETE' then
    insert into audit_log (entity, entity_id, action, changes, actor_id)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), current_profile_id());
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- deals, contacts and tasks each have amo_id after migration 00100.
    if new.amo_id is null then
      insert into audit_log (entity, entity_id, action, changes, actor_id)
      values (tg_table_name, new.id, 'insert', to_jsonb(new), current_profile_id());
    end if;
    return new;
  end if;

  old_j := to_jsonb(old);
  new_j := to_jsonb(new);
  for k in select jsonb_object_keys(new_j) loop
    if new_j -> k is distinct from old_j -> k and k not in ('updated_at') then
      diff := diff || jsonb_build_object(
        k, jsonb_build_object('was', old_j -> k, 'now', new_j -> k)
      );
    end if;
  end loop;

  if diff <> '{}'::jsonb then
    insert into audit_log (entity, entity_id, action, changes, actor_id)
    values (tg_table_name, new.id, 'update', diff, current_profile_id());
  end if;
  return new;
end;
$$;
