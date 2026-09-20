-- Migration 20260920180600 declared these trigger writers SECURITY DEFINER,
-- but the live database still has SECURITY INVOKER on all three functions.
-- Authenticated deal updates then fail when the audit trigger inserts its log.
alter function public.record_stage_transition() security definer;
alter function public.record_stage_transition() set search_path = public, pg_temp;

alter function public.create_touch_task() security definer;
alter function public.create_touch_task() set search_path = public, pg_temp;

alter function public.write_audit() security definer;
alter function public.write_audit() set search_path = public, pg_temp;
