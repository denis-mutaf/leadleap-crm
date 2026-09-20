-- A completed task can carry the outcome of the call, meeting, or follow-up.
-- Imported Amo tasks remain valid even when their historical result is absent.
alter table public.tasks
  add column if not exists result_text text;

comment on column public.tasks.result_text is
  'Human-readable outcome entered when a manager completes a task.';
