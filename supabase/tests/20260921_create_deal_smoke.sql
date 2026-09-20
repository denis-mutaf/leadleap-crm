-- Run with `supabase db query --file`; all inserted rows are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where role = 'admin' and is_active order by id limit 1
), true);

do $$
declare
  v_source_id uuid;
  v_project_id uuid;
  v_stage_id uuid;
  actor_id uuid := auth.uid();
  test_phone text := '+999' || lpad(floor(random() * 100000000000)::bigint::text, 11, '0');
  first_result jsonb;
  duplicate_result jsonb;
  reused_result jsonb;
  created_contact_id uuid;
  created_deal_id uuid;
  imported_phone text;
  invalid_reuse_rejected boolean := false;
begin
  if actor_id is null then raise exception 'Missing authenticated admin'; end if;
  select id into v_source_id from public.sources where is_active order by id limit 1;
  select id into v_project_id from public.projects where is_active order by id limit 1;
  select id into v_stage_id from public.stages
    where is_active and kind = 'open' order by position limit 1;

  first_result := public.create_crm_deal(
    'QA temporary', test_phone, v_source_id, array[v_project_id], v_stage_id,
    'QA temporary deal', actor_id, null, '{}'::uuid[], 'QA temporary note', null
  );
  if first_result ->> 'kind' <> 'created' then
    raise exception 'First create failed: %', first_result;
  end if;
  created_deal_id := (first_result ->> 'deal_id')::uuid;
  select d.contact_id into created_contact_id from public.deals d where d.id = created_deal_id;
  if created_contact_id is null or not exists (
    select 1 from public.contact_phones p
    where p.contact_id = created_contact_id and p.phone = public.normalize_phone(test_phone)
  ) or not exists (
    select 1 from public.deal_contacts dc
    where dc.deal_id = created_deal_id and dc.contact_id = created_contact_id and dc.is_primary
  ) or not exists (
    select 1 from public.deal_projects dp
    where dp.deal_id = created_deal_id and dp.project_id = v_project_id
  ) or not exists (
    select 1 from public.stage_transitions st where st.deal_id = created_deal_id
  ) or not exists (
    select 1 from public.notes n where n.deal_id = created_deal_id
  ) then
    raise exception 'Atomic create omitted a related row';
  end if;

  duplicate_result := public.create_crm_deal(
    'QA temporary', test_phone, v_source_id, array[v_project_id], v_stage_id,
    'QA duplicate blocked', actor_id, null, '{}'::uuid[], null, null
  );
  if duplicate_result ->> 'kind' <> 'duplicate' or not exists (
    select 1 from public.find_contacts_by_phone(test_phone) f
    where f.contact_id = created_contact_id
  ) then
    raise exception 'Duplicate was not detected';
  end if;

  reused_result := public.create_crm_deal(
    'QA temporary', test_phone, v_source_id, array[v_project_id], v_stage_id,
    'QA reused contact', actor_id, null, '{}'::uuid[], null, created_contact_id
  );
  if reused_result ->> 'kind' <> 'created' or (
    select d.contact_id from public.deals d
    where d.id = (reused_result ->> 'deal_id')::uuid
  ) <> created_contact_id then
    raise exception 'Reuse contact failed';
  end if;

  if (select count(*) from public.contacts c where c.id = created_contact_id) <> 1
    or (select count(*) from public.deals d where d.contact_id = created_contact_id) <> 2 then
    raise exception 'Unexpected contact/deal cardinality';
  end if;

  begin
    perform public.create_crm_deal(
      'QA temporary', test_phone, v_source_id, array[v_project_id], v_stage_id,
      'QA invalid reuse', actor_id, null, '{}'::uuid[], null, gen_random_uuid()
    );
  exception when invalid_parameter_value then
    invalid_reuse_rejected := true;
  end;
  if not invalid_reuse_rejected then
    raise exception 'Unrelated contact was accepted';
  end if;

  select ip.normalized_phone into imported_phone
  from public.imported_contact_phones ip
  where length(regexp_replace(coalesce(ip.normalized_phone, ''), '\D', '', 'g')) >= 8
  order by ip.contact_id, ip.ordinal limit 1;
  if imported_phone is null or not exists (
    select 1 from public.find_contacts_by_phone(
      right(regexp_replace(imported_phone, '\D', '', 'g'), 8)
    )
  ) then
    raise exception 'Imported Amo phone was not found by last eight digits';
  end if;
end;
$$;

rollback;
