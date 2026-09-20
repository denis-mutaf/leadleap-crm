-- Read-only outside this transaction. Role and setting changes are rolled back.
begin;
set local statement_timeout = '120s';

do $$
begin
  if (select value from settings where key = 'manager_visibility') <> '"all"'::jsonb then
    raise exception 'expected current team-wide manager visibility';
  end if;
end;
$$;

select set_config('rls_test.manager_id', (
  select id::text from profiles
  where role = 'manager' and amo_id is not null order by id limit 1
), true);
select set_config('rls_test.admin_id', (
  select id::text from profiles where role = 'admin' order by id limit 1
), true);

select set_config('request.jwt.claim.sub', current_setting('rls_test.manager_id'), true);
set local role authenticated;
do $$
declare
  deleted_rows integer;
begin
  if my_role() <> 'manager' or (select count(*) from deals) <> 5749 then
    raise exception 'shared manager visibility failed';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
    or not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'profile column privileges failed';
  end if;
  delete from deals where id = (select id from deals limit 1);
  get diagnostics deleted_rows = row_count;
  if deleted_rows <> 0 then raise exception 'manager deleted a deal'; end if;
end;
$$;
reset role;

update settings set value = '"own"'::jsonb where key = 'manager_visibility';
select set_config('request.jwt.claim.sub', current_setting('rls_test.manager_id'), true);
set local role authenticated;
do $$
begin
  if (select count(*) from deals) >= 5749
    or (select count(*) from contacts) >= 5932 then
    raise exception 'owner-only visibility leaked other records';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('rls_test.admin_id'), true);
set local role authenticated;
do $$
begin
  if my_role() <> 'admin'
    or (select count(*) from deals) <> 5749
    or (select count(*) from contacts) <> 5932
    or (select count(*) from notes) <> 14125 then
    raise exception 'admin visibility changed';
  end if;
end;
$$;
reset role;

update profiles set role = 'builder'
where id = current_setting('rls_test.manager_id')::uuid;
select set_config('request.jwt.claim.sub', current_setting('rls_test.manager_id'), true);
set local role authenticated;
do $$
begin
  if my_role() <> 'builder'
    or (select count(*) from deals) <> 0
    or (select count(*) from contacts) <> 0
    or (select count(*) from contact_phones) <> 0
    or (select count(*) from imported_contact_phones) <> 0
    or (select count(*) from notes) <> 0
    or (select count(*) from calls) <> 0
    or (select count(*) from tasks) <> 0 then
    raise exception 'builder can read CRM records';
  end if;
end;
$$;
reset role;
rollback;
