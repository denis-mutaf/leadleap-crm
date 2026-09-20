-- Manual intake: find duplicate numbers and create contact + deal atomically.
-- Imported Amo contacts can share a number, so look in both phone tables.

create or replace function public.find_contacts_by_phone(p_phone text)
returns table (
  contact_id uuid,
  full_name text,
  latest_deal_id uuid,
  latest_stage text,
  deal_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  phone_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
begin
  if auth.uid() is null or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 8 then
    return;
  end if;

  return query
  with matched as (
    select distinct coalesce(c.merged_into, c.id) as id
    from public.contacts c
    where exists (
      select 1 from public.contact_phones cp
      where cp.contact_id = c.id
        and right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail
    ) or exists (
      select 1 from public.imported_contact_phones ip
      where ip.contact_id = c.id
        and right(regexp_replace(coalesce(ip.normalized_phone, ip.raw_phone), '\D', '', 'g'), 8) = phone_tail
    )
  )
  select c.id, c.full_name, recent.id, recent.stage_name,
    (select count(*) from public.deals d
     where (d.contact_id = c.id or exists (
       select 1 from public.deal_contacts dc
       where dc.deal_id = d.id and dc.contact_id = c.id
     )) and public.can_see_deal(d.id))
  from matched m
  join public.contacts c on c.id = m.id
  left join lateral (
    select d.id, s.name as stage_name, d.created_at
    from public.deals d
    join public.stages s on s.id = d.stage_id
    where (d.contact_id = c.id or exists (
      select 1 from public.deal_contacts dc
      where dc.deal_id = d.id and dc.contact_id = c.id
    )) and public.can_see_deal(d.id)
    order by d.created_at desc, d.id desc
    limit 1
  ) recent on true
  where public.can_see_contact(c.id)
  order by recent.created_at desc nulls last, c.full_name, c.id
  limit 20;
end;
$$;

create or replace function public.create_crm_deal(
  p_full_name text,
  p_phone text,
  p_source_id uuid,
  p_project_ids uuid[],
  p_stage_id uuid,
  p_title text,
  p_owner_id uuid,
  p_object_text text,
  p_tag_ids uuid[],
  p_note text,
  p_reuse_contact_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized text := public.normalize_phone(p_phone);
  phone_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  phone_tail text;
  matched_ids uuid[];
  target_contact uuid;
  target_deal uuid;
  project_count integer;
  tag_count integer;
begin
  if actor_id is null or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null or char_length(btrim(p_full_name)) > 200
    or nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 300 then
    raise exception 'Name and deal title are required' using errcode = '22023';
  end if;
  if length(phone_digits) < 8 or length(phone_digits) > 15 or normalized is null then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  if p_source_id is null or not exists (
    select 1 from public.sources where id = p_source_id and is_active
  ) then
    raise exception 'Choose an active source' using errcode = '22023';
  end if;
  if p_stage_id is null or not exists (
    select 1 from public.stages where id = p_stage_id and is_active and kind = 'open'
  ) then
    raise exception 'Choose an active open stage' using errcode = '22023';
  end if;
  if p_owner_id is not null and not exists (
    select 1 from public.profiles
    where id = p_owner_id and is_active and role in ('manager', 'head', 'admin')
  ) then
    raise exception 'Choose an active owner' using errcode = '22023';
  end if;
  if p_owner_id is not null and p_owner_id <> actor_id and not public.sees_everything() then
    raise exception 'Owner is not assignable' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_project_ids), 0) = 0
    or array_position(p_project_ids, null::uuid) is not null then
    raise exception 'Choose a project' using errcode = '22023';
  end if;
  select count(distinct id) into project_count from public.projects
  where id = any(p_project_ids) and is_active;
  if project_count <> (select count(distinct id) from unnest(p_project_ids) as x(id)) then
    raise exception 'Invalid project selection' using errcode = '22023';
  end if;
  if array_position(p_tag_ids, null::uuid) is not null then
    raise exception 'Invalid tag selection' using errcode = '22023';
  end if;
  select count(distinct id) into tag_count from public.tags where id = any(p_tag_ids);
  if tag_count <> (select count(distinct id) from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as x(id)) then
    raise exception 'Invalid tag selection' using errcode = '22023';
  end if;

  phone_tail := right(phone_digits, 8);
  perform pg_advisory_xact_lock(hashtextextended(phone_tail, 0));
  select array_agg(distinct coalesce(c.merged_into, c.id)) into matched_ids
  from public.contacts c
  where exists (
    select 1 from public.contact_phones cp
    where cp.contact_id = c.id
      and right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail
  ) or exists (
    select 1 from public.imported_contact_phones ip
    where ip.contact_id = c.id
      and right(regexp_replace(coalesce(ip.normalized_phone, ip.raw_phone), '\D', '', 'g'), 8) = phone_tail
  );

  if p_reuse_contact_id is null and coalesce(cardinality(matched_ids), 0) > 0 then
    return jsonb_build_object('kind', 'duplicate', 'count', cardinality(matched_ids));
  end if;
  if p_reuse_contact_id is not null then
    if not (p_reuse_contact_id = any(coalesce(matched_ids, '{}'::uuid[])))
      or not public.can_see_contact(p_reuse_contact_id) then
      raise exception 'Selected contact does not match this phone' using errcode = '22023';
    end if;
    target_contact := p_reuse_contact_id;
  else
    begin
      insert into public.contacts (full_name, created_by)
      values (btrim(p_full_name), actor_id) returning id into target_contact;
      insert into public.contact_phones (contact_id, phone, is_primary)
      values (target_contact, normalized, true);
    exception when unique_violation then
      return jsonb_build_object('kind', 'duplicate', 'count', 1);
    end;
  end if;

  insert into public.deals (
    contact_id, owner_id, stage_id, title, object_text, source_id, created_by
  ) values (
    target_contact, p_owner_id, p_stage_id, btrim(p_title),
    nullif(btrim(p_object_text), ''), p_source_id, actor_id
  ) returning id into target_deal;
  insert into public.deal_contacts (deal_id, contact_id, is_primary)
  values (target_deal, target_contact, true);
  insert into public.deal_projects (deal_id, project_id)
  select target_deal, id from unnest(p_project_ids) as x(id) group by id;
  insert into public.deal_tags (deal_id, tag_id, created_by)
  select target_deal, id, actor_id
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as x(id) group by id;
  if nullif(btrim(p_note), '') is not null then
    insert into public.notes (deal_id, contact_id, author_id, body)
    values (target_deal, target_contact, actor_id, btrim(p_note));
  end if;

  return jsonb_build_object('kind', 'created', 'deal_id', target_deal);
end;
$$;

revoke all on function public.find_contacts_by_phone(text) from public, anon;
revoke all on function public.create_crm_deal(
  text, text, uuid, uuid[], uuid, text, uuid, text, uuid[], text, uuid
) from public, anon;
grant execute on function public.find_contacts_by_phone(text) to authenticated;
grant execute on function public.create_crm_deal(
  text, text, uuid, uuid[], uuid, text, uuid, text, uuid[], text, uuid
) to authenticated;
