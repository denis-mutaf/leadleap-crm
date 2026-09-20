-- Keep source-only values available to the CRM without granting access to the
-- private raw snapshot. The mapped columns serve the common UI fields.
alter table contacts add column amo_custom_fields jsonb;

alter table deals add column amo_status_id bigint;
alter table deals add column amo_source_id bigint;
alter table deals add column rooms_text text;
alter table deals add column down_payment_text text;
alter table deals add column monthly_payment_text text;
alter table deals add column amo_custom_fields jsonb;

comment on column deals.amo_status_id is
  'Original Amo status, including which reservation lane was used.';
comment on column deals.amo_source_id is
  'Original Amo source ID when the source dictionary has no safe CRM mapping.';
comment on column deals.rooms_text is
  'Unparsed room preferences, including ranges and free text.';
comment on column deals.down_payment_text is
  'Original amount or range/percentage from Amo; numeric down_payment is set only for exact amounts.';
comment on column deals.monthly_payment_text is
  'Original monthly payment text or range from Amo.';
