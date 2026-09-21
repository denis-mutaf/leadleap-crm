-- One Amo task points to an entity absent from the complete lead/contact
-- snapshot. Keep it visible for manual reassignment without inventing a deal.
alter table tasks add column amo_entity_id bigint;

alter table tasks drop constraint tasks_belongs_somewhere;
alter table tasks add constraint tasks_belongs_somewhere check (
  deal_id is not null
  or contact_id is not null
  or (
    amo_id is not null
    and amo_entity_type = 'unresolved'
    and amo_entity_id is not null
  )
);

comment on column tasks.amo_entity_id is
  'Original Amo entity ID; the unresolved imported task keeps it for manual reassignment.';
