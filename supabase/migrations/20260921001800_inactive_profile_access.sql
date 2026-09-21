-- An inactive profile must lose data access even while its Auth JWT remains valid.
-- Keep self-read so the login flow can explain that the account was disabled.
create or replace function public.my_role()
returns public.user_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;

alter policy profiles_read on public.profiles using (
  public.my_role() in ('manager', 'head', 'admin') or id = auth.uid()
);
alter policy profiles_self_update on public.profiles
  using (public.my_role() is not null and id = auth.uid())
  with check (public.my_role() is not null and id = auth.uid());

-- The builder's only data surface is the anonymous dashboard, not raw CRM
-- dictionaries or personnel records.
alter policy projects_read on public.projects using (public.my_role() in ('manager', 'head', 'admin'));
alter policy stages_read on public.stages using (public.my_role() in ('manager', 'head', 'admin'));
alter policy sources_read on public.sources using (public.my_role() in ('manager', 'head', 'admin'));
alter policy lost_reasons_read on public.lost_reasons using (public.my_role() in ('manager', 'head', 'admin'));
alter policy task_types_read on public.task_types using (public.my_role() in ('manager', 'head', 'admin'));
alter policy tags_read on public.tags using (public.my_role() in ('manager', 'head', 'admin'));
alter policy settings_read on public.settings using (public.my_role() in ('manager', 'head', 'admin'));
alter policy custom_field_defs_read on public.custom_field_defs using (public.my_role() in ('manager', 'head', 'admin'));
alter policy notification_rules_read on public.notification_rules using (public.my_role() in ('manager', 'head', 'admin'));
alter policy notifications_own on public.notifications
  using (public.my_role() in ('manager', 'head', 'admin') and user_id = auth.uid())
  with check (public.my_role() in ('manager', 'head', 'admin') and user_id = auth.uid());
