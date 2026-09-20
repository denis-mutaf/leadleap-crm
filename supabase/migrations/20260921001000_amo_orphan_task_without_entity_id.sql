-- The single unresolved Amo task has neither entity_type nor entity_id.
-- Keep it only when it carries an Amo ID and an explicit unresolved marker.
alter table tasks drop constraint tasks_belongs_somewhere;
alter table tasks add constraint tasks_belongs_somewhere check (
  deal_id is not null
  or contact_id is not null
  or (amo_id is not null and amo_entity_type = 'unresolved')
);
