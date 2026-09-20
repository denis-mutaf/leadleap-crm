-- Resume a partially completed contact import without rewriting 5,924 cards.
-- Run through `supabase db query --linked --file` after both Amo tag dictionaries
-- are prepared. Everything is checked in one transaction.
begin;

do $$
declare
  missing_tags bigint;
  imported_contacts bigint;
begin
  select count(*) into imported_contacts from contacts where amo_id is not null;
  if imported_contacts <> 5924 then
    raise exception 'Expected 5924 imported contacts, found %', imported_contacts;
  end if;

  select count(*) into missing_tags
  from amo_import_records r
  cross join lateral jsonb_array_elements(
    coalesce(r.payload -> '_embedded' -> 'tags', '[]'::jsonb)
  ) source_tag
  left join tags t on t.amo_id = (source_tag ->> 'id')::bigint
  where r.entity_type = 'contact' and t.id is null;
  if missing_tags <> 0 then
    raise exception 'Amo contact tags missing from dictionary: %', missing_tags;
  end if;
end;
$$;

insert into contact_tags (contact_id, tag_id)
select c.id, t.id
from amo_import_records r
join contacts c on c.amo_id = r.amo_id::bigint
cross join lateral jsonb_array_elements(
  coalesce(r.payload -> '_embedded' -> 'tags', '[]'::jsonb)
) source_tag
join tags t on t.amo_id = (source_tag ->> 'id')::bigint
where r.entity_type = 'contact'
on conflict (contact_id, tag_id) do nothing;

-- The original timestamps and source fields were in the first batch before
-- those columns/links were completed. Avoid fabricating audit edits or touching
-- updated_at while copying from the private source snapshot.
alter table contacts disable trigger contacts_touch;
alter table contacts disable trigger contacts_audit;

update contacts c
set updated_at = to_timestamp((r.payload ->> 'updated_at')::double precision),
    amo_custom_fields = r.payload -> 'custom_fields_values'
from amo_import_records r
where r.entity_type = 'contact' and c.amo_id = r.amo_id::bigint;

alter table contacts enable trigger contacts_audit;
alter table contacts enable trigger contacts_touch;

do $$
declare
  tag_links bigint;
  bad_times bigint;
  bad_fields bigint;
begin
  select count(*) into tag_links
  from contact_tags ct join contacts c on c.id = ct.contact_id
  where c.amo_id is not null;
  if tag_links <> 644 then
    raise exception 'Expected 644 imported contact tags, found %', tag_links;
  end if;

  select count(*) into bad_times
  from contacts c
  join amo_import_records r
    on r.entity_type = 'contact' and r.amo_id::bigint = c.amo_id
  where c.updated_at is distinct from
    to_timestamp((r.payload ->> 'updated_at')::double precision);
  if bad_times <> 0 then
    raise exception 'Contact source timestamps mismatch: %', bad_times;
  end if;

  select count(*) into bad_fields
  from contacts c
  join amo_import_records r
    on r.entity_type = 'contact' and r.amo_id::bigint = c.amo_id
  where c.amo_custom_fields is distinct from
    r.payload -> 'custom_fields_values';
  if bad_fields <> 0 then
    raise exception 'Contact source fields mismatch: %', bad_fields;
  end if;
end;
$$;

commit;
