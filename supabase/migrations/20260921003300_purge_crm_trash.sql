-- Service-role-only, bounded retention purge.
--
-- Safe scope is deliberately limited to notes. Notes have no child FK and no
-- existing write_audit DELETE trigger. Deals, contacts and tasks are rejected:
-- deals/contacts have non-cascade call/conversation/import dependencies, and
-- tasks have a DELETE audit trigger that serializes the row (including content).
-- No dynamic SQL and no scheduling are used here.

create or replace function public.purge_crm_trash(
  p_entity text default 'notes',
  p_limit integer default 50
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  purge_ids uuid[];
  purged_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'CRM trash purge is not permitted';
  end if;

  if p_entity is distinct from 'notes' then
    raise exception using errcode = '22023', message = 'CRM trash purge type is not supported';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid CRM trash purge batch size';
  end if;

  select coalesce(array_agg(candidate.id), '{}'::uuid[])
  into purge_ids
  from (
    select n.id
    from public.notes n
    where n.deleted_at is not null
      and n.deleted_at <= clock_timestamp() - interval '30 days'
    order by n.deleted_at asc, n.id
    limit p_limit
    for update skip locked
  ) candidate;

  if cardinality(purge_ids) = 0 then
    return 0;
  end if;

  insert into public.audit_log (entity, entity_id, action, changes, actor_id, created_at)
  select
    'notes', id, 'purge',
    jsonb_build_object('retention_days', 30, 'service_purge', true),
    null, clock_timestamp()
  from unnest(purge_ids) as purged(id);

  delete from public.notes
  where id = any (purge_ids)
    and deleted_at is not null
    and deleted_at <= clock_timestamp() - interval '30 days';

  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on function public.purge_crm_trash(text, integer) from public;
revoke all on function public.purge_crm_trash(text, integer) from authenticated;
grant execute on function public.purge_crm_trash(text, integer) to service_role;
