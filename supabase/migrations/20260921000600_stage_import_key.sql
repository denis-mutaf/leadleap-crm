-- An idempotent key for the new stage set while the demo stages are still active.
alter table stages add column import_key text unique;
