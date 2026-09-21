-- Typed soft-delete/restore RPCs. No physical purge is implemented here.

create or replace function public.soft_delete_crm_record(p_entity text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  role_name public.user_role := public.my_role();
  deal_row public.deals%rowtype;
  contact_row public.contacts%rowtype;
  note_row public.notes%rowtype;
  task_row public.tasks%rowtype;
begin
  if actor is null or role_name is null or role_name not in ('manager', 'head', 'admin') then
    raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
  end if;

  case p_entity
    when 'deals' then
      select * into deal_row from public.deals where id = p_id for update;
      if not found or deal_row.deleted_at is not null
        or not public.can_see_deal(p_id) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.deals
      set deleted_at = clock_timestamp(), deleted_by = actor
      where id = p_id and deleted_at is null and deleted_by is null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('deals', p_id, 'soft_delete', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    when 'contacts' then
      select * into contact_row from public.contacts where id = p_id for update;
      if not found or contact_row.deleted_at is not null
        or not public.can_see_contact(p_id) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      if exists (
        select 1 from public.deals d
        where d.contact_id = p_id and d.deleted_at is null
      ) or exists (
        select 1
        from public.deal_contacts dc
        join public.deals d on d.id = dc.deal_id
        where dc.contact_id = p_id and d.deleted_at is null
      ) then
        raise exception using errcode = '23000', message = 'CRM record cannot be deleted while active deals exist';
      end if;

      update public.contacts
      set deleted_at = clock_timestamp(), deleted_by = actor
      where id = p_id and deleted_at is null and deleted_by is null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('contacts', p_id, 'soft_delete', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    when 'notes' then
      select * into note_row from public.notes where id = p_id for update;
      if not found or note_row.deleted_at is not null
        or note_row.deal_id is null and note_row.contact_id is null
        or (note_row.deal_id is not null and not public.can_see_deal(note_row.deal_id))
        or (note_row.contact_id is not null and not public.can_see_contact(note_row.contact_id)) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.notes
      set deleted_at = clock_timestamp(), deleted_by = actor
      where id = p_id and deleted_at is null and deleted_by is null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('notes', p_id, 'soft_delete', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    when 'tasks' then
      select * into task_row from public.tasks where id = p_id for update;
      if not found or task_row.deleted_at is not null
        or (task_row.deal_id is not null and not public.can_see_deal(task_row.deal_id))
        or (task_row.contact_id is not null and not public.can_see_contact(task_row.contact_id))
        or (task_row.deal_id is null
          and not (public.sees_everything() or task_row.assignee_id = actor)) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.tasks
      set deleted_at = clock_timestamp(), deleted_by = actor
      where id = p_id and deleted_at is null and deleted_by is null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('tasks', p_id, 'soft_delete', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    else
      raise exception using errcode = '22023', message = 'Unsupported CRM record type';
  end case;
end;
$$;

create or replace function public.restore_crm_record(p_entity text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  role_name public.user_role := public.my_role();
  deal_row public.deals%rowtype;
  contact_row public.contacts%rowtype;
  note_row public.notes%rowtype;
  task_row public.tasks%rowtype;
begin
  if actor is null or role_name is null or role_name not in ('manager', 'head', 'admin') then
    raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
  end if;

  case p_entity
    when 'deals' then
      select * into deal_row from public.deals where id = p_id for update;
      if not found or deal_row.deleted_at is null
        or deal_row.deleted_at <= clock_timestamp() - interval '30 days'
        or (role_name = 'manager' and deal_row.deleted_by <> actor)
        or exists (
          select 1 from public.contacts c
          where c.id = deal_row.contact_id and c.deleted_at is not null
        )
        or exists (
          select 1
          from public.deal_contacts dc
          join public.contacts c on c.id = dc.contact_id
          where dc.deal_id = p_id and c.deleted_at is not null
        ) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.deals
      set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null and deleted_by is not null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('deals', p_id, 'restore', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    when 'contacts' then
      select * into contact_row from public.contacts where id = p_id for update;
      if not found or contact_row.deleted_at is null
        or contact_row.deleted_at <= clock_timestamp() - interval '30 days'
        or (role_name = 'manager' and contact_row.deleted_by <> actor) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.contacts
      set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null and deleted_by is not null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('contacts', p_id, 'restore', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    when 'notes' then
      select * into note_row from public.notes where id = p_id for update;
      if not found or note_row.deleted_at is null
        or note_row.deleted_at <= clock_timestamp() - interval '30 days'
        or (role_name = 'manager' and note_row.deleted_by <> actor)
        or (note_row.deal_id is not null and not public.can_see_deal(note_row.deal_id))
        or (note_row.contact_id is not null and not public.can_see_contact(note_row.contact_id)) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.notes
      set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null and deleted_by is not null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('notes', p_id, 'restore', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    when 'tasks' then
      select * into task_row from public.tasks where id = p_id for update;
      if not found or task_row.deleted_at is null
        or task_row.deleted_at <= clock_timestamp() - interval '30 days'
        or (role_name = 'manager' and task_row.deleted_by <> actor)
        or (task_row.deal_id is not null and not public.can_see_deal(task_row.deal_id))
        or (task_row.contact_id is not null and not public.can_see_contact(task_row.contact_id)) then
        raise exception using errcode = '42501', message = 'CRM record operation is not permitted';
      end if;

      update public.tasks
      set deleted_at = null, deleted_by = null
      where id = p_id and deleted_at is not null and deleted_by is not null;

      insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
      values ('tasks', p_id, 'restore', jsonb_build_object('deleted_at', true), actor, clock_timestamp());

    else
      raise exception using errcode = '22023', message = 'Unsupported CRM record type';
  end case;
end;
$$;

revoke all on function public.soft_delete_crm_record(text, uuid) from public;
revoke all on function public.restore_crm_record(text, uuid) from public;
grant execute on function public.soft_delete_crm_record(text, uuid) to authenticated;
grant execute on function public.restore_crm_record(text, uuid) to authenticated;

create or replace function public.guard_active_crm_contact_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  contact_deleted_at timestamptz;
  deal_deleted_at timestamptz;
begin
  if tg_table_name = 'deals' then
    if new.deleted_at is null then
      select c.deleted_at into contact_deleted_at
      from public.contacts c
      where c.id = new.contact_id
      for update;

      if not found or contact_deleted_at is not null then
        raise exception using errcode = '23514', message = 'Active CRM record cannot reference a deleted contact';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'deal_contacts' then
    select d.deleted_at into deal_deleted_at
    from public.deals d
    where d.id = new.deal_id
    for update;

    select c.deleted_at into contact_deleted_at
    from public.contacts c
    where c.id = new.contact_id
    for update;

    if not found or deal_deleted_at is not null or contact_deleted_at is not null then
      raise exception using errcode = '23514', message = 'Active CRM record cannot reference a deleted contact';
    end if;
    return new;
  end if;

  raise exception using errcode = '22023', message = 'Unsupported CRM link guard';
end;
$$;

create or replace trigger deals_active_contact_guard
before insert or update of contact_id, deleted_at on public.deals
for each row execute function public.guard_active_crm_contact_link();

create or replace trigger deal_contacts_active_contact_guard
before insert or update of deal_id, contact_id on public.deal_contacts
for each row execute function public.guard_active_crm_contact_link();
