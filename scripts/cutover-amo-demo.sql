-- One-time production cutover. Source backup (mode 0600, kept outside git):
-- .scratch/amo-cutover/demo-backup-20260920221319.json
-- SHA256 0759631ca522540835edcc60ba8116c6f49a8b59d7c742756a4a2a8192aaf343
-- Review by replacing the final COMMIT with ROLLBACK before applying this file.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Serialize against application writes while the snapshot and deletes are checked.
lock table deals, contacts, tasks, notes, calls, stages, stage_transitions,
  deal_projects, deal_tags, deal_contacts, contact_phones, contact_channels,
  contact_tags, imported_contact_phones, contact_emails, conversations,
  messages, notifications, audit_log, tags, lost_reasons, amo_stage_map
  in share row exclusive mode;

create temp table cutover_demo_deals on commit drop as
  select id from deals where amo_id is null;
create temp table cutover_demo_contacts on commit drop as
  select id from contacts where amo_id is null;
create temp table cutover_demo_tasks on commit drop as
  select id from tasks where amo_id is null;
create temp table cutover_demo_entities on commit drop as
  select id from cutover_demo_deals
  union select id from cutover_demo_contacts
  union select id from cutover_demo_tasks;

do $$
declare
  check_row record;
begin
  -- Count + sorted-ID fingerprint ties the selection to the private backup.
  for check_row in
    select * from (values
      ('demo deals', (select count(*) from cutover_demo_deals), 35::bigint),
      ('demo contacts', (select count(*) from cutover_demo_contacts), 33::bigint),
      ('demo tasks', (select count(*) from cutover_demo_tasks), 42::bigint),
      ('Amo deals', (select count(*) from deals where amo_id is not null), 5749::bigint),
      ('Amo contacts including synthetic', (select count(*) from contacts where amo_id is not null), 5932::bigint),
      ('Amo tasks', (select count(*) from tasks where amo_id is not null), 1707::bigint),
      ('Amo notes', (select count(*) from notes where amo_id is not null), 14125::bigint),
      ('Amo calls', (select count(*) from calls where external_id like 'amo-note:%'), 7502::bigint),
      ('Amo transitions', (select count(*) from stage_transitions where amo_event_id is not null), 2323::bigint),
      ('Amo stage mappings', (select count(*) from amo_stage_map), 16::bigint),
      ('legacy stages', (select count(*) from stages where import_key is null and is_active), 8::bigint),
      ('inactive Amo stages', (select count(*) from stages where import_key is not null and not is_active), 12::bigint),
      ('demo contact phones', (select count(*) from contact_phones where contact_id in (select id from cutover_demo_contacts)), 33::bigint),
      ('demo contact channels', (select count(*) from contact_channels where contact_id in (select id from cutover_demo_contacts)), 11::bigint),
      ('demo deal projects', (select count(*) from deal_projects where deal_id in (select id from cutover_demo_deals)), 40::bigint),
      ('demo deal tags', (select count(*) from deal_tags where deal_id in (select id from cutover_demo_deals)), 34::bigint),
      ('demo transitions', (select count(*) from stage_transitions where deal_id in (select id from cutover_demo_deals)), 140::bigint),
      ('demo notes', (select count(*) from notes where deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts)), 64::bigint),
      ('demo calls', (select count(*) from calls where deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts)), 56::bigint),
      ('demo audit', (select count(*) from audit_log where entity_id in (select id from cutover_demo_entities)), 110::bigint),
      ('demo conversations', (select count(*) from conversations where contact_id in (select id from cutover_demo_contacts)), 0::bigint),
      ('demo notifications', (select count(*) from notifications where deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts)), 0::bigint),
      ('demo deal_contacts', (select count(*) from deal_contacts where deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts)), 0::bigint),
      ('Amo deals on demo contacts', (select count(*) from deals where amo_id is not null and contact_id in (select id from cutover_demo_contacts)), 0::bigint),
      ('Amo deals on legacy stages', (select count(*) from deals d join stages s on s.id = d.stage_id where d.amo_id is not null and s.import_key is null), 0::bigint),
      ('Amo tasks on demo entities', (select count(*) from tasks where amo_id is not null and (deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts))), 0::bigint),
      ('Amo notes on demo entities', (select count(*) from notes where amo_id is not null and (deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts))), 0::bigint),
      ('Amo calls on demo entities', (select count(*) from calls where external_id like 'amo-note:%' and (deal_id in (select id from cutover_demo_deals) or contact_id in (select id from cutover_demo_contacts))), 0::bigint),
      ('Amo transitions on legacy stages', (select count(*) from stage_transitions st join stages s on s.id = st.to_stage_id where st.amo_event_id is not null and s.import_key is null), 0::bigint),
      ('Amo mappings on legacy stages', (select count(*) from amo_stage_map m join stages s on s.id = m.stage_id where s.import_key is null), 0::bigint),
      ('imported phones on demo contacts', (select count(*) from imported_contact_phones where contact_id in (select id from cutover_demo_contacts)), 0::bigint),
      ('imported emails on demo contacts', (select count(*) from contact_emails where contact_id in (select id from cutover_demo_contacts)), 0::bigint),
      ('other contacts merged into demo', (select count(*) from contacts where amo_id is not null and merged_into in (select id from cutover_demo_contacts)), 0::bigint),
      ('Amo links to legacy tags', (select count(*) from deal_tags dt join deals d on d.id = dt.deal_id join tags t on t.id = dt.tag_id where d.amo_id is not null and t.amo_id is null), 0::bigint),
      ('Amo contacts linked to legacy tags', (select count(*) from contact_tags ct join contacts c on c.id = ct.contact_id join tags t on t.id = ct.tag_id where c.amo_id is not null and t.amo_id is null), 0::bigint)
    ) as checks(label, actual, expected)
  loop
    if check_row.actual <> check_row.expected then
      raise exception 'cutover preflight: % expected %, found %', check_row.label, check_row.expected, check_row.actual;
    end if;
  end loop;

  if (select md5(string_agg(id::text, ',' order by id::text)) from cutover_demo_deals) <> '7445f225b132f880dc93d5179c32b2b6'
    or (select md5(string_agg(id::text, ',' order by id::text)) from cutover_demo_contacts) <> 'fbf7cac4ac7badab3babd052e2b36fda'
    or (select md5(string_agg(id::text, ',' order by id::text)) from cutover_demo_tasks) <> '345c777c4c189351fe6a05b0c30afd03'
    or (select md5(string_agg(id::text, ',' order by id::text)) from audit_log where entity_id in (select id from cutover_demo_entities)) <> '78cee5a927b8839c8aa292075348df4b'
    or (select md5(string_agg(id::text, ',' order by id::text)) from stages where import_key is null) <> '36c474e3f285247588ca2abc92f98a17'
    or (select md5(string_agg(id::text, ',' order by id::text)) from tags where amo_id is null) <> 'fb38b01b80ef0c4b8ccc03e50b804336'
    or (select md5(string_agg(id::text, ',' order by id::text)) from lost_reasons where amo_id is null and name <> 'Не указана в Amo') <> 'e8e55e5aec7a7e7ec84460b121881245'
  then
    raise exception 'cutover preflight: live IDs differ from private backup';
  end if;
end;
$$;

-- Calls have restrictive FKs; remove them before their demo deal/contact.
delete from calls where deal_id in (select id from cutover_demo_deals)
  or contact_id in (select id from cutover_demo_contacts);
delete from tasks where id in (select id from cutover_demo_tasks);
delete from notes where deal_id in (select id from cutover_demo_deals)
  or contact_id in (select id from cutover_demo_contacts);
delete from deals where id in (select id from cutover_demo_deals);
delete from contacts where id in (select id from cutover_demo_contacts);
-- Delete old audit plus the delete-trigger entries for these same entities.
delete from audit_log where entity_id in (select id from cutover_demo_entities);

-- Remove only dictionaries that belonged exclusively to the demo.
delete from stages where import_key is null;
delete from tags where amo_id is null;
delete from lost_reasons where amo_id is null and name <> 'Не указана в Amo';
update stages set is_active = true where import_key is not null;

do $$
begin
  if (select count(*) from deals) <> 5749
    or (select count(*) from contacts) <> 5932
    or (select count(*) from tasks) <> 1707
    or (select count(*) from notes) <> 14125
    or (select count(*) from calls) <> 7502
    or (select count(*) from stages where is_active) <> 12
    or (select count(*) from stages where import_key is null) <> 0
    or (select count(*) from audit_log where entity_id in (select id from cutover_demo_entities)) <> 0
    or (select count(*) from tags where amo_id is null) <> 0
    or (select count(*) from lost_reasons where amo_id is null) <> 1
  then
    raise exception 'cutover postflight failed; transaction rolled back';
  end if;
end;
$$;

commit;
