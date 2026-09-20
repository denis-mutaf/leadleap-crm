-- Keep the Amo snapshot separate from live CRM records until the import is verified.
-- Only service_role can access this table; RLS has no authenticated policies.
create table amo_import_records (
  entity_type text not null check (entity_type in (
    'lead', 'contact', 'task', 'lead_note', 'contact_note', 'event',
    'pipeline', 'user', 'lead_tag', 'contact_tag', 'loss_reason',
    'lead_field', 'contact_field', 'unsorted'
  )),
  amo_id text not null,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (entity_type, amo_id)
);

alter table amo_import_records enable row level security;

comment on table amo_import_records is
  'Private, idempotent snapshot of Amo API records. No CRM screen reads this staging table.';

-- The source IDs let a resumed import upsert safely and make count reconciliation exact.
alter table profiles add column amo_id bigint unique;
alter table contacts add column amo_id bigint unique;
alter table deals add column amo_id bigint unique;
alter table tasks add column amo_id bigint unique;
alter table notes add column amo_id bigint unique;

-- Amo stores deal price separately from the buyer qualification budget.
alter table deals add column amount numeric(14, 2);
alter table deals add column construction_stage text;
alter table deals add column down_payment numeric(14, 2);
alter table deals add column monthly_payment numeric(14, 2);
alter table deals add column purchase_timing_text text;
alter table deals add column residency_detail text;
alter table deals add column desired_area_text text;
alter table deals add column desired_floor_text text;
alter table deals add column wishes text;

comment on column deals.amount is 'Amo deal price; distinct from the qualification budget.';
comment on column deals.purchase_timing_text is
  'Original free-text planned purchase date from Amo; not coerced to the narrower horizon enum.';
comment on column deals.residency_detail is
  'Original five-option Amo residency value, including planned arrival timing.';
