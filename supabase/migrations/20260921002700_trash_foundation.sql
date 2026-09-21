-- Trash foundation only.
-- This migration adds no delete/restore API and performs no physical deletion.

alter table public.deals
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

alter table public.contacts
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

alter table public.notes
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

alter table public.tasks
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

alter table public.deals add constraint deals_deleted_pair_chk
  check ((deleted_at is null) = (deleted_by is null));
alter table public.contacts add constraint contacts_deleted_pair_chk
  check ((deleted_at is null) = (deleted_by is null));
alter table public.notes add constraint notes_deleted_pair_chk
  check ((deleted_at is null) = (deleted_by is null));
alter table public.tasks add constraint tasks_deleted_pair_chk
  check ((deleted_at is null) = (deleted_by is null));

create index deals_active_idx on public.deals (owner_id, updated_at desc)
  where deleted_at is null;
create index deals_trash_idx on public.deals (deleted_at desc)
  where deleted_at is not null;
create index contacts_active_idx on public.contacts (updated_at desc)
  where deleted_at is null;
create index contacts_trash_idx on public.contacts (deleted_at desc)
  where deleted_at is not null;
create index notes_active_deal_idx on public.notes (deal_id, created_at desc)
  where deleted_at is null;
create index notes_active_contact_idx on public.notes (contact_id, created_at desc)
  where deleted_at is null;
create index tasks_active_deal_idx on public.tasks (deal_id, due_at)
  where deleted_at is null;
create index tasks_active_contact_idx on public.tasks (contact_id, due_at)
  where deleted_at is null;

-- No authenticated caller may mutate these columns directly. Other existing
-- table/column privileges and the existing ordinary update policies remain intact.
revoke update (deleted_at, deleted_by) on public.deals from authenticated;
revoke update (deleted_at, deleted_by) on public.contacts from authenticated;
revoke update (deleted_at, deleted_by) on public.notes from authenticated;
revoke update (deleted_at, deleted_by) on public.tasks from authenticated;

-- Physical deletion is not a supported authenticated operation. The future
-- service-only purge will use a separate, explicitly privileged path.
drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals for delete to authenticated
  using (false);
drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts for delete to authenticated
  using (false);
drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (false);
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (false);

create or replace function public.can_see_deal(target_deal uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.my_role() in ('manager', 'head', 'admin') and exists (
    select 1
    from public.deals d
    where d.id = target_deal
      and d.deleted_at is null
      and (public.sees_everything() or d.owner_id = auth.uid() or d.owner_id is null)
  );
$$;

create or replace function public.can_see_contact(target_contact uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.my_role() in ('manager', 'head', 'admin') and exists (
    select 1
    from public.contacts c
    where c.id = target_contact
      and c.deleted_at is null
      and (
        public.sees_everything()
        or c.created_by = auth.uid()
        or exists (
          select 1 from public.deals d
          where d.contact_id = c.id
            and d.deleted_at is null
            and (d.owner_id = auth.uid() or d.owner_id is null)
        )
        or exists (
          select 1
          from public.deal_contacts dc
          join public.deals d on d.id = dc.deal_id
          where dc.contact_id = c.id
            and d.deleted_at is null
            and (d.owner_id = auth.uid() or d.owner_id is null)
        )
      )
  );
$$;

-- Keep the existing active-row access rules, but make their base rows explicit.
alter policy deals_read on public.deals using (
  public.my_role() in ('manager', 'head', 'admin')
  and deleted_at is null
  and (public.sees_everything() or owner_id = auth.uid() or owner_id is null)
);
alter policy deals_insert on public.deals with check (
  public.my_role() in ('manager', 'head', 'admin')
  and deleted_at is null and deleted_by is null
  and (public.sees_everything() or owner_id = auth.uid() or owner_id is null)
);
alter policy deals_update on public.deals
  using (
    public.my_role() in ('manager', 'head', 'admin')
    and deleted_at is null
    and deleted_by is null
    and (public.sees_everything() or owner_id = auth.uid() or owner_id is null)
  )
  with check (
    public.my_role() in ('manager', 'head', 'admin')
    and deleted_at is null
    and deleted_by is null
    and (public.sees_everything() or owner_id = auth.uid() or owner_id is null)
  );

alter policy contacts_read on public.contacts using (public.can_see_contact(id));
alter policy contacts_insert on public.contacts with check (
  public.my_role() in ('manager', 'head', 'admin')
  and created_by = auth.uid()
  and deleted_at is null and deleted_by is null
);
alter policy contacts_update on public.contacts
  using (public.can_see_contact(id) and deleted_at is null and deleted_by is null)
  with check (public.can_see_contact(id) and deleted_at is null and deleted_by is null);

alter policy notes_read on public.notes using (
  deleted_at is null
  and public.my_role() in ('manager', 'head', 'admin')
  and ((deal_id is not null and public.can_see_deal(deal_id))
    or (deal_id is null and contact_id is not null and public.can_see_contact(contact_id)))
);
alter policy notes_insert on public.notes with check (
  deleted_at is null
  and deleted_by is null
  and public.my_role() in ('manager', 'head', 'admin')
  and ((deal_id is not null and public.can_see_deal(deal_id))
    or (deal_id is null and contact_id is not null and public.can_see_contact(contact_id)))
);
alter policy notes_update on public.notes
  using (
    deleted_at is null
    and deleted_by is null
    and public.my_role() in ('manager', 'head', 'admin')
    and ((deal_id is not null and public.can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and public.can_see_contact(contact_id)))
  )
  with check (
    deleted_at is null
    and deleted_by is null
    and public.my_role() in ('manager', 'head', 'admin')
    and ((deal_id is not null and public.can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and public.can_see_contact(contact_id)))
  );

alter policy tasks_read on public.tasks using (
  deleted_at is null
  and deleted_by is null
  and public.my_role() in ('manager', 'head', 'admin')
  and ((deal_id is null and contact_id is null
        and (public.sees_everything() or assignee_id = auth.uid()))
    or (deal_id is not null and public.can_see_deal(deal_id)
        and (contact_id is null or public.can_see_contact(contact_id)))
    or (deal_id is null and contact_id is not null
        and public.can_see_contact(contact_id)
        and (public.sees_everything() or assignee_id = auth.uid())))
);
alter policy tasks_insert on public.tasks with check (
  deleted_at is null and deleted_by is null
  and public.my_role() in ('manager', 'head', 'admin')
  and (deal_id is null or public.can_see_deal(deal_id))
  and (contact_id is null or public.can_see_contact(contact_id))
  and (deal_id is not null
    or (public.sees_everything() or assignee_id = auth.uid()))
);
alter policy tasks_update on public.tasks
  using (
    deleted_at is null
    and deleted_by is null
    and public.my_role() in ('manager', 'head', 'admin')
    and ((deal_id is null and contact_id is null
        and (public.sees_everything() or assignee_id = auth.uid()))
      or (deal_id is not null and public.can_see_deal(deal_id)
        and (contact_id is null or public.can_see_contact(contact_id)))
      or (deal_id is null and contact_id is not null
        and public.can_see_contact(contact_id)
        and (public.sees_everything() or assignee_id = auth.uid())))
  )
  with check (
    deleted_at is null
    and deleted_by is null
    and public.my_role() in ('manager', 'head', 'admin')
    and (deal_id is null or public.can_see_deal(deal_id))
    and (contact_id is null or public.can_see_contact(contact_id))
    and (deal_id is not null
      or (public.sees_everything() or assignee_id = auth.uid()))
  );

alter policy calls_read on public.calls using (
  public.my_role() in ('manager', 'head', 'admin')
  and ((deal_id is not null and public.can_see_deal(deal_id))
    or (deal_id is null and contact_id is not null and public.can_see_contact(contact_id)))
);
alter policy calls_write on public.calls using (
  public.my_role() in ('manager', 'head', 'admin')
  and ((deal_id is not null and public.can_see_deal(deal_id))
    or (deal_id is null and contact_id is not null and public.can_see_contact(contact_id)))
) with check (public.my_role() in ('manager', 'head', 'admin'));

alter policy stage_transitions_read on public.stage_transitions
  using (public.can_see_deal(deal_id));
alter policy deal_contacts_all on public.deal_contacts
  using (public.can_see_deal(deal_id))
  with check (public.can_see_deal(deal_id) and public.can_see_contact(contact_id));
alter policy imported_contact_phones_read on public.imported_contact_phones
  using (public.can_see_contact(contact_id));
alter policy contact_emails_read on public.contact_emails
  using (public.can_see_contact(contact_id));

alter policy conversations_all on public.conversations
  using (public.can_see_contact(contact_id))
  with check (public.can_see_contact(contact_id));
alter policy messages_all on public.messages
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and public.can_see_contact(c.contact_id)
  ))
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and public.can_see_contact(c.contact_id)
  ));

alter policy notifications_own on public.notifications
  using (
    public.my_role() in ('manager', 'head', 'admin')
    and user_id = auth.uid()
    and (deal_id is null or public.can_see_deal(deal_id))
    and (contact_id is null or public.can_see_contact(contact_id))
  )
  with check (public.my_role() in ('manager', 'head', 'admin') and user_id = auth.uid());
