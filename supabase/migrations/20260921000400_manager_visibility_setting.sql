-- The sales team currently works across all owners' deals in Amo. Keep this
-- configurable for a later switch to owner-only visibility.
insert into settings (key, value)
values ('manager_visibility', '"all"'::jsonb)
on conflict (key) do nothing;

create or replace function sees_everything()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select my_role() in ('head', 'admin')
    or (
      my_role() = 'manager'
      and exists (
        select 1 from settings
        where key = 'manager_visibility' and value = '"all"'::jsonb
      )
    );
$$;
