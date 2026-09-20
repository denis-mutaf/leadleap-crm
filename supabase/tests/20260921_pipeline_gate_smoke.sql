-- Transactional smoke test. No QA rows or stage settings persist.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where role = 'admin' and is_active order by id limit 1
), true);

do $$
declare
  actor_id uuid := auth.uid();
  v_source_id uuid;
  v_project_id uuid;
  first_stage_id uuid;
  second_stage_id uuid;
  lost_stage_id uuid;
  reason_id uuid;
  qa_deal_id uuid;
  result jsonb;
  rejected boolean := false;
begin
  if actor_id is null then raise exception 'Missing authenticated admin'; end if;
  select id into v_source_id from public.sources where is_active order by id limit 1;
  select id into v_project_id from public.projects where is_active order by id limit 1;
  select id into first_stage_id from public.stages
    where is_active and kind = 'open' order by position limit 1;
  select id into second_stage_id from public.stages
    where is_active and kind = 'open' and position > (
      select position from public.stages where id = first_stage_id
    ) order by position limit 1;
  select id into lost_stage_id from public.stages
    where is_active and kind = 'lost' order by position limit 1;
  select id into reason_id from public.lost_reasons
    where is_active order by position limit 1;

  result := public.create_crm_deal(
    'QA temporary gates', '+999' || lpad(floor(random() * 100000000000)::bigint::text, 11, '0'),
    v_source_id, array[v_project_id], first_stage_id, 'QA temporary gates',
    actor_id, null, '{}'::uuid[], null, null
  );
  if result ->> 'kind' <> 'created' then raise exception 'QA deal create failed'; end if;
  qa_deal_id := (result ->> 'deal_id')::uuid;
  update public.stages set requires_next_step = true,
    requires_qualification_tag = true where id = second_stage_id;

  begin
    perform public.transition_crm_deal(
      qa_deal_id, second_stage_id, actor_id, null, null,
      null, null, null, null, null
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected or (select stage_id from public.deals where id = qa_deal_id) <> first_stage_id
    or exists (select 1 from public.tasks where deal_id = qa_deal_id) then
    raise exception 'Missing gates did not block move atomically';
  end if;

  result := public.transition_crm_deal(
    qa_deal_id, second_stage_id, actor_id, null, null,
    'КВАЛ', 'QA follow-up', now() + interval '1 day', null, actor_id
  );
  if result ->> 'stage_id' <> second_stage_id::text
    or not exists (
      select 1 from public.tasks where deal_id = qa_deal_id and done_at is null
    ) or not exists (
      select 1 from public.deal_tags dt join public.tags t on t.id = dt.tag_id
      where dt.deal_id = qa_deal_id and t.name = 'КВАЛ'
    ) then
    raise exception 'Task, qualification and move were not committed together';
  end if;

  rejected := false;
  begin
    perform public.transition_crm_deal(
      qa_deal_id, lost_stage_id, actor_id, null, null,
      null, null, null, null, null
    );
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then raise exception 'Loss reason was optional'; end if;
  result := public.transition_crm_deal(
    qa_deal_id, lost_stage_id, actor_id, reason_id, 'QA reason',
    null, null, null, null, null
  );
  if result ->> 'status' <> 'lost' or (
    select lost_reason_id from public.deals where id = qa_deal_id
  ) <> reason_id then
    raise exception 'Lost move failed';
  end if;
end;
$$;

rollback;
