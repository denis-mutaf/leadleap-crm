-- Keep row visibility consistent across a deal, its contact and related records.
-- The original FOR ALL policies unintentionally widened SELECT access because
-- PostgreSQL combines permissive policies with OR.

create or replace function public.can_see_deal(target_deal uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select my_role() in ('manager', 'head', 'admin') and exists (
    select 1 from public.deals d
    where d.id = target_deal
      and (sees_everything() or d.owner_id = auth.uid() or d.owner_id is null)
  );
$$;

create or replace function public.can_see_contact(target_contact uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select my_role() in ('manager', 'head', 'admin') and exists (
    select 1 from public.contacts c
    where c.id = target_contact and (
      sees_everything() or c.created_by = auth.uid()
      or exists (
        select 1 from public.deals d
        where d.contact_id = c.id
          and (d.owner_id = auth.uid() or d.owner_id is null)
      )
      or exists (
        select 1 from public.deal_contacts dc
        join public.deals d on d.id = dc.deal_id
        where dc.contact_id = c.id
          and (d.owner_id = auth.uid() or d.owner_id is null)
      )
    )
  );
$$;

create or replace function public.can_see_custom_value(target_field uuid, target_entity uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.custom_field_defs f
    where f.id = target_field
      and ((f.entity = 'deal' and can_see_deal(target_entity))
        or (f.entity = 'contact' and can_see_contact(target_entity)))
  );
$$;

alter policy deals_read on public.deals using (
  my_role() in ('manager', 'head', 'admin')
  and (sees_everything() or owner_id = auth.uid() or owner_id is null)
);
alter policy deals_insert on public.deals with check (
  my_role() in ('manager', 'head', 'admin')
  and (sees_everything() or owner_id = auth.uid() or owner_id is null)
);
alter policy deals_update on public.deals
  using (my_role() in ('manager', 'head', 'admin')
    and (sees_everything() or owner_id = auth.uid() or owner_id is null))
  with check (my_role() in ('manager', 'head', 'admin')
    and (sees_everything() or owner_id = auth.uid() or owner_id is null));
-- manager_visibility = "all" grants team visibility, not destructive rights.
alter policy deals_delete on public.deals using (my_role() in ('head', 'admin'));

drop policy contacts_write on public.contacts;
alter policy contacts_read on public.contacts using (can_see_contact(id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (my_role() in ('manager', 'head', 'admin') and created_by = auth.uid());
create policy contacts_update on public.contacts for update to authenticated
  using (can_see_contact(id)) with check (can_see_contact(id));
create policy contacts_delete on public.contacts for delete to authenticated
  using (my_role() in ('head', 'admin'));
-- A row policy cannot prevent a self-update from changing a privileged column.
-- Profile role/active state is managed only by the server-side admin flow.
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;
revoke update on public.contacts from authenticated;
grant update (full_name, merged_into) on public.contacts to authenticated;

drop policy contact_phones_all on public.contact_phones;
create policy contact_phones_read on public.contact_phones for select to authenticated
  using (can_see_contact(contact_id));
create policy contact_phones_insert on public.contact_phones for insert to authenticated
  with check (can_see_contact(contact_id));
create policy contact_phones_update on public.contact_phones for update to authenticated
  using (can_see_contact(contact_id)) with check (can_see_contact(contact_id));
create policy contact_phones_delete on public.contact_phones for delete to authenticated
  using (can_see_contact(contact_id));

drop policy contact_channels_all on public.contact_channels;
create policy contact_channels_read on public.contact_channels for select to authenticated
  using (can_see_contact(contact_id));
create policy contact_channels_insert on public.contact_channels for insert to authenticated
  with check (can_see_contact(contact_id));
create policy contact_channels_update on public.contact_channels for update to authenticated
  using (can_see_contact(contact_id)) with check (can_see_contact(contact_id));
create policy contact_channels_delete on public.contact_channels for delete to authenticated
  using (can_see_contact(contact_id));

drop policy contact_tags_all on public.contact_tags;
create policy contact_tags_read on public.contact_tags for select to authenticated
  using (can_see_contact(contact_id));
create policy contact_tags_insert on public.contact_tags for insert to authenticated
  with check (can_see_contact(contact_id));
create policy contact_tags_delete on public.contact_tags for delete to authenticated
  using (can_see_contact(contact_id));

alter policy imported_contact_phones_read on public.imported_contact_phones
  using (can_see_contact(contact_id));
alter policy contact_emails_read on public.contact_emails
  using (can_see_contact(contact_id));

drop policy notes_all on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (my_role() in ('manager', 'head', 'admin') and
    ((deal_id is not null and can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and can_see_contact(contact_id))));
create policy notes_insert on public.notes for insert to authenticated
  with check (my_role() in ('manager', 'head', 'admin') and
    ((deal_id is not null and can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and can_see_contact(contact_id))));
create policy notes_update on public.notes for update to authenticated
  using (my_role() in ('manager', 'head', 'admin') and
    ((deal_id is not null and can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and can_see_contact(contact_id))))
  with check (my_role() in ('manager', 'head', 'admin') and
    ((deal_id is not null and can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and can_see_contact(contact_id))));
create policy notes_delete on public.notes for delete to authenticated
  using (my_role() in ('head', 'admin'));

alter policy calls_read on public.calls using (
  my_role() in ('manager', 'head', 'admin') and
  (sees_everything() or (deal_id is not null and can_see_deal(deal_id))
    or (deal_id is null and contact_id is not null and can_see_contact(contact_id)))
);
alter policy calls_write on public.calls
  using (my_role() in ('manager', 'head', 'admin') and
    (sees_everything() or (deal_id is not null and can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and can_see_contact(contact_id))))
  with check (my_role() in ('manager', 'head', 'admin') and
    (sees_everything() or (deal_id is not null and can_see_deal(deal_id))
      or (deal_id is null and contact_id is not null and can_see_contact(contact_id))));

drop policy tasks_write on public.tasks;
alter policy tasks_read on public.tasks using (
  my_role() in ('manager', 'head', 'admin') and
  (sees_everything() or assignee_id = auth.uid()
    or (deal_id is not null and can_see_deal(deal_id))
    or (deal_id is null and contact_id is not null and can_see_contact(contact_id)))
);
create policy tasks_insert on public.tasks for insert to authenticated
  with check (my_role() in ('manager', 'head', 'admin')
    and (sees_everything() or assignee_id = auth.uid()
      or (deal_id is not null and can_see_deal(deal_id)))
    and (deal_id is null or can_see_deal(deal_id))
    and (contact_id is null or can_see_contact(contact_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (my_role() in ('manager', 'head', 'admin') and
    (sees_everything() or assignee_id = auth.uid()
      or (deal_id is not null and can_see_deal(deal_id))))
  with check (my_role() in ('manager', 'head', 'admin')
    and (sees_everything() or assignee_id = auth.uid()
      or (deal_id is not null and can_see_deal(deal_id)))
    and (deal_id is null or can_see_deal(deal_id))
    and (contact_id is null or can_see_contact(contact_id)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (my_role() in ('head', 'admin'));

alter policy audit_read on public.audit_log using (my_role() in ('head', 'admin'));

drop policy custom_values_all on public.custom_field_values;
create policy custom_values_read on public.custom_field_values for select to authenticated
  using (can_see_custom_value(field_id, entity_id));
create policy custom_values_insert on public.custom_field_values for insert to authenticated
  with check (can_see_custom_value(field_id, entity_id));
create policy custom_values_update on public.custom_field_values for update to authenticated
  using (can_see_custom_value(field_id, entity_id))
  with check (can_see_custom_value(field_id, entity_id));
create policy custom_values_delete on public.custom_field_values for delete to authenticated
  using (can_see_custom_value(field_id, entity_id));
