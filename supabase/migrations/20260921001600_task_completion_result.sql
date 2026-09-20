-- New completions record the outcome of the call, meeting, or follow-up.
-- Imported Amo tasks remain valid even when their historical result is absent.
alter table public.tasks
  add column if not exists result_text text;

comment on column public.tasks.result_text is
  'Human-readable outcome entered when a manager completes a task.';

-- Existing Amo completions were imported before this rule. New completions
-- must preserve the result alongside done_at in the same update.
create or replace function public.require_task_completion_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.done_at is null and new.done_at is not null
    and nullif(btrim(new.result_text), '') is null then
    raise exception 'Task completion requires a result' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_completion_result_required on public.tasks;
create trigger tasks_completion_result_required
before update of done_at, result_text on public.tasks
for each row execute function public.require_task_completion_result();
