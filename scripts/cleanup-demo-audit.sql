-- One-time cleanup of orphaned pre-import smoke-test audit pairs.
-- Private backup: .scratch/amo-cutover/orphan-audit-before-cleanup.json
-- SHA256 f49940a6a6cae6267aa77a783f1bc36751ad2b933983ad5f6b6f583e9240d7e6
begin;
set local lock_timeout = '10s';
lock table audit_log in share row exclusive mode;

do $$
begin
  if (select count(*) from audit_log) <> 450
    or (select md5(string_agg(id::text, ',' order by id::text)) from audit_log)
       <> '9e2918904badbaa4c7f36ee563861fcd'
    or (select count(*) from (
          select entity, entity_id
          from audit_log
          group by entity, entity_id
          having count(*) = 2
            and count(*) filter (where action = 'insert') = 1
            and count(*) filter (where action = 'delete') = 1
        ) pairs) <> 225
    or (select count(*) from audit_log where created_at < '2026-09-20 18:37:00+00'
         or created_at >= '2026-09-20 18:41:00+00') <> 0
    or (select count(*) from audit_log where entity not in ('deals', 'contacts', 'tasks')) <> 0
    or (select count(*) from audit_log a where
          (entity = 'deals' and exists (select 1 from deals d where d.id = a.entity_id))
          or (entity = 'contacts' and exists (select 1 from contacts c where c.id = a.entity_id))
          or (entity = 'tasks' and exists (select 1 from tasks t where t.id = a.entity_id))) <> 0
  then
    raise exception 'orphan audit cleanup preflight failed';
  end if;
end;
$$;

delete from audit_log;

do $$
begin
  if (select count(*) from audit_log) <> 0 then
    raise exception 'orphan audit cleanup postflight failed';
  end if;
end;
$$;

commit;
