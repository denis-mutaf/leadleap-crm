-- Aggregate dictionary usage without bypassing the caller's RLS policies.
create or replace function public.dictionary_usage_counts()
returns table (dictionary_key text, value_id uuid, usage bigint)
language sql
security invoker
set search_path = public
stable
as $$
  select 'tags'::text, tag_id, count(*)::bigint from public.deal_tags group by tag_id
  union all
  select 'tags'::text, tag_id, count(*)::bigint from public.contact_tags group by tag_id
  union all
  select 'sources'::text, source_id, count(*)::bigint from public.deals where source_id is not null group by source_id
  union all
  select 'task_types'::text, type_id, count(*)::bigint from public.tasks where type_id is not null group by type_id
  union all
  select 'lost_reasons'::text, lost_reason_id, count(*)::bigint from public.deals where lost_reason_id is not null group by lost_reason_id
  union all
  select 'projects'::text, project_id, count(*)::bigint from public.deal_projects group by project_id;
$$;

revoke all on function public.dictionary_usage_counts() from public;
grant execute on function public.dictionary_usage_counts() to authenticated;
