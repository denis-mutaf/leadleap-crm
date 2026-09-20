-- Exercise the same authenticated writes as the deal record UI.
-- Every QA row is rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where role = 'manager' and is_active order by id limit 1
), true);

do $$
declare
  actor_id uuid := auth.uid();
  v_source_id uuid;
  v_project_id uuid;
  v_stage_id uuid;
  qa_deal_id uuid;
  qa_note_id uuid;
  qa_task_id uuid;
  result jsonb;
begin
  if actor_id is null then raise exception 'Missing manager'; end if;
  select id into v_source_id from public.sources where is_active order by id limit 1;
  select id into v_project_id from public.projects where is_active order by id limit 1;
  select id into v_stage_id from public.stages
    where is_active and kind = 'open' order by position limit 1;
  result := public.create_crm_deal(
    'QA temporary record', '+999' || lpad(floor(random() * 100000000000)::bigint::text, 11, '0'),
    v_source_id, array[v_project_id], v_stage_id, 'QA temporary record actions',
    actor_id, null, '{}'::uuid[], null, null
  );
  if result ->> 'kind' <> 'created' then raise exception 'Create failed'; end if;
  qa_deal_id := (result ->> 'deal_id')::uuid;

  insert into public.notes (deal_id, author_id, body)
  values (qa_deal_id, actor_id, 'QA note') returning id into qa_note_id;
  insert into public.tasks (deal_id, assignee_id, title, due_at, created_by)
  values (qa_deal_id, actor_id, 'QA task', now() + interval '1 day', actor_id)
  returning id into qa_task_id;
  update public.tasks set done_at = now(), done_by = actor_id
  where id = qa_task_id;

  if not exists (select 1 from public.notes where id = qa_note_id)
    or not exists (
      select 1 from public.tasks
      where id = qa_task_id and done_at is not null and done_by = actor_id
    ) then
    raise exception 'Record actions did not persist under RLS';
  end if;
end;
$$;

rollback;
