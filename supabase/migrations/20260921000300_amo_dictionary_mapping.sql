-- Amo IDs are stable source keys. Four reservation statuses share one CRM stage,
-- so their mapping lives in a separate table rather than stages.amo_id.
alter table tags add column amo_id bigint unique;
alter table lost_reasons add column amo_id bigint unique;

create table amo_stage_map (
  amo_status_id bigint primary key,
  stage_id uuid not null references stages (id),
  mapped_at timestamptz not null default now()
);

alter table amo_stage_map enable row level security;

comment on table amo_stage_map is
  'Private mapping from original Amo status to CRM stage; reservation statuses may share one stage.';
