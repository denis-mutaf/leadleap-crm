-- Restore the agreed discipline after the Amo snapshot has been imported.
-- The structured qualification-field gate remains opt-in; the team marks
-- qualification manually with either КВАЛ or неквал.
do $migration$
declare
  stage_count integer;
  updated_count integer;
begin
  select count(*) into stage_count
  from public.stages
  where is_active and import_key in (
    'amo:stage:10', 'amo:stage:20', 'amo:stage:30', 'amo:stage:40',
    'amo:stage:50', 'amo:stage:60', 'amo:stage:70', 'amo:stage:80',
    'amo:stage:90', 'amo:stage:100', 'amo:stage:110', 'amo:stage:120'
  );
  if stage_count <> 12 then
    raise exception 'Expected 12 active imported stages, found %', stage_count;
  end if;

  update public.stages
  set requires_next_step = import_key in (
        'amo:stage:10', 'amo:stage:20', 'amo:stage:30',
        'amo:stage:50', 'amo:stage:60', 'amo:stage:70',
        'amo:stage:80', 'amo:stage:90', 'amo:stage:100'
      ),
      requires_qualification_tag = import_key in (
        'amo:stage:50', 'amo:stage:60', 'amo:stage:70',
        'amo:stage:80', 'amo:stage:90', 'amo:stage:100'
      ),
      requires_qualification = false
  where is_active and import_key in (
    'amo:stage:10', 'amo:stage:20', 'amo:stage:30', 'amo:stage:40',
    'amo:stage:50', 'amo:stage:60', 'amo:stage:70', 'amo:stage:80',
    'amo:stage:90', 'amo:stage:100', 'amo:stage:110', 'amo:stage:120'
  );
  get diagnostics updated_count = row_count;
  if updated_count <> 12 then
    raise exception 'Expected to update 12 stages, updated %', updated_count;
  end if;
end;
$migration$;
