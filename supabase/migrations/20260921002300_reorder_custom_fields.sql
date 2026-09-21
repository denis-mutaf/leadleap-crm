-- Reorder active custom fields as one transaction. Hidden fields keep their
-- historical position until restored; they are never offered as drag targets.
create or replace function public.reorder_crm_custom_fields(
  p_entity public.custom_entity,
  p_field_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_count integer;
begin
  if not coalesce(public.my_role() = 'admin', false) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  if p_entity is null or p_field_ids is null
     or cardinality(p_field_ids) > 32767
     or array_position(p_field_ids, null) is not null then
    raise exception 'invalid field order' using errcode = '22023';
  end if;

  perform id from public.custom_field_defs
  where entity = p_entity
  for update;

  select count(*) into active_count
  from public.custom_field_defs
  where entity = p_entity and is_active;

  if cardinality(p_field_ids) <> active_count
     or (select count(distinct field_id)
         from unnest(p_field_ids) as selected(field_id)) <> active_count
     or exists (
       select 1
       from unnest(p_field_ids) as selected(field_id)
       left join public.custom_field_defs as definition
         on definition.id = selected.field_id
       where definition.id is null
          or definition.entity <> p_entity
          or not definition.is_active
     ) then
    raise exception 'field order changed; refresh and retry' using errcode = '22023';
  end if;

  update public.custom_field_defs as definition
  set position = selected.ordinality - 1
  from unnest(p_field_ids) with ordinality as selected(field_id, ordinality)
  where definition.id = selected.field_id;
end;
$$;

revoke all on function public.reorder_crm_custom_fields(public.custom_entity, uuid[]) from public;
grant execute on function public.reorder_crm_custom_fields(public.custom_entity, uuid[]) to authenticated;
