-- Keep every imported contact association even though the card has one primary contact.
create table deal_contacts (
  deal_id uuid not null references deals (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  is_primary boolean not null default false,
  primary key (deal_id, contact_id)
);

create index deal_contacts_contact_idx on deal_contacts (contact_id);
alter table deal_contacts enable row level security;
create policy deal_contacts_all on deal_contacts for all to authenticated
  using (can_see_deal(deal_id)) with check (can_see_deal(deal_id));

-- Amo has repeated numbers across contacts. contact_phones stays unique for intake
-- matching; this table keeps every original phone and its normalized candidate.
create table imported_contact_phones (
  contact_id uuid not null references contacts (id) on delete cascade,
  ordinal smallint not null,
  raw_phone text not null,
  normalized_phone text,
  label text,
  primary key (contact_id, ordinal)
);

create index imported_contact_phones_normalized_idx
  on imported_contact_phones (normalized_phone);
alter table imported_contact_phones enable row level security;
create policy imported_contact_phones_read on imported_contact_phones
  for select to authenticated using (
    exists (select 1 from contacts where contacts.id = contact_id)
  );

create table contact_emails (
  contact_id uuid not null references contacts (id) on delete cascade,
  ordinal smallint not null,
  email text not null,
  label text,
  primary key (contact_id, ordinal)
);

alter table contact_emails enable row level security;
create policy contact_emails_read on contact_emails
  for select to authenticated using (
    exists (select 1 from contacts where contacts.id = contact_id)
  );

alter table task_types add column amo_id bigint unique;
alter table tasks alter column assignee_id drop not null;
alter table tasks add column amo_entity_type text;
alter table tasks add column amo_result jsonb;

alter table notes add column amo_note_type text;
alter table notes add column amo_params jsonb;

alter table deals add column amo_pipeline_id bigint;
alter table deals add column closed_at timestamptz;
alter table stage_transitions add column amo_event_id text unique;
