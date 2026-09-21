-- Keep old imported tag IDs for provenance while removing merged tags from use.
alter table public.tags
  add column if not exists is_active boolean not null default true,
  add column if not exists merged_into uuid references public.tags (id);

alter table public.tags
  add constraint tags_merge_state_check
  check (merged_into is null or (not is_active and merged_into <> id));

create or replace function public.merge_crm_tag(
  p_source_id uuid,
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_tag public.tags%rowtype;
  target_tag public.tags%rowtype;
  deal_links integer;
  contact_links integer;
begin
  if not coalesce(public.my_role() in ('head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_source_id is null or p_target_id is null or p_source_id = p_target_id then
    raise exception 'Choose two different tags' using errcode = '22023';
  end if;

  -- Lock in one order so opposite merges cannot deadlock.
  perform 1 from public.tags
    where id in (p_source_id, p_target_id)
    order by id for update;
  select * into source_tag from public.tags where id = p_source_id;
  select * into target_tag from public.tags where id = p_target_id;
  if source_tag.id is null or target_tag.id is null then
    raise exception 'Tag not found' using errcode = 'P0002';
  end if;
  if not source_tag.is_active or not target_tag.is_active then
    raise exception 'Both tags must be active' using errcode = '22023';
  end if;

  select count(*) into deal_links from public.deal_tags where tag_id = p_source_id;
  select count(*) into contact_links from public.contact_tags where tag_id = p_source_id;

  insert into public.deal_tags (deal_id, tag_id, created_by, created_at)
    select deal_id, p_target_id, created_by, created_at
    from public.deal_tags where tag_id = p_source_id
    on conflict (deal_id, tag_id) do nothing;
  insert into public.contact_tags (contact_id, tag_id, created_by, created_at)
    select contact_id, p_target_id, created_by, created_at
    from public.contact_tags where tag_id = p_source_id
    on conflict (contact_id, tag_id) do nothing;

  delete from public.deal_tags where tag_id = p_source_id;
  delete from public.contact_tags where tag_id = p_source_id;
  update public.tags
    set is_active = false, merged_into = p_target_id
    where id = p_source_id;

  insert into public.audit_log (entity, entity_id, action, actor_id, changes)
    values (
      'tag', p_source_id, 'merge', auth.uid(),
      jsonb_build_object(
        'source_name', source_tag.name,
        'target_id', p_target_id,
        'target_name', target_tag.name,
        'deal_links', deal_links,
        'contact_links', contact_links
      )
    );

  return jsonb_build_object(
    'source_id', p_source_id,
    'target_id', p_target_id,
    'deal_links', deal_links,
    'contact_links', contact_links
  );
end;
$$;

revoke all on function public.merge_crm_tag(uuid, uuid) from public;
grant execute on function public.merge_crm_tag(uuid, uuid) to authenticated;
