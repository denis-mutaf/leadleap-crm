-- Replace the applied atomic web-form intake function with trash-aware logic.
-- 027 owns the deleted_at columns; 028 is intentionally not touched here.

create or replace function public.process_web_form_event(
  p_event_id uuid,
  p_phone text,
  p_name text,
  p_comment text,
  p_utm jsonb,
  p_meta_campaign_id text,
  p_unknown jsonb,
  p_unknown_labels jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  event_row public.inbound_events%rowtype;
  normalized text := public.normalize_phone(p_phone);
  phone_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  phone_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
  matched_ids uuid[];
  deleted_match_id uuid;
  target_contact_id uuid;
  target_deal_id uuid;
  stage_id uuid;
  source_id uuid;
  target_field_id uuid;
  field_key text;
  field_value jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into event_row
  from public.inbound_events
  where id = p_event_id
  for update;
  if not found then
    raise exception 'Inbound event not found' using errcode = '22023';
  end if;

  if event_row.processed_at is not null then
    select d.id into target_deal_id
    from public.deals d
    where d.intake_event_id = p_event_id and d.deleted_at is null;
    if target_deal_id is null then
      select n.deal_id into target_deal_id
      from public.notes n
      where n.intake_event_id = p_event_id and n.deleted_at is null;
    end if;
    if target_deal_id is null then
      -- Stable duplicate acknowledgement even when the original deal is trashed.
      select d.id into target_deal_id
      from public.deals d
      where d.intake_event_id = p_event_id;
    end if;
    return jsonb_build_object('deal_id', target_deal_id, 'duplicate', true);
  end if;

  if normalized is null or length(phone_digits) < 8 or length(phone_digits) > 15 then
    raise exception 'Некорректный номер телефона' using errcode = '22023';
  end if;

  select c.id into deleted_match_id
  from public.contacts c
  where c.deleted_at is not null
    and (exists (
      select 1 from public.contact_phones cp
      where cp.contact_id = c.id
        and (cp.phone = normalized or right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail)
    ) or exists (
      select 1 from public.imported_contact_phones ip
      where ip.contact_id = c.id and ip.normalized_phone is not null
        and (ip.normalized_phone = normalized
          or right(regexp_replace(ip.normalized_phone, '\D', '', 'g'), 8) = phone_tail)
    ))
  limit 1;
  if deleted_match_id is not null then
    raise exception 'Phone resolves to deleted contact' using errcode = '55006';
  end if;

  select array_agg(distinct coalesce(c.merged_into, c.id)) into matched_ids
  from public.contacts c
  where c.deleted_at is null
    and (exists (
      select 1 from public.contact_phones cp
      where cp.contact_id = c.id
        and (cp.phone = normalized or right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail)
    ) or exists (
      select 1 from public.imported_contact_phones ip
      where ip.contact_id = c.id and ip.normalized_phone is not null
        and (ip.normalized_phone = normalized
          or right(regexp_replace(ip.normalized_phone, '\D', '', 'g'), 8) = phone_tail)
    ));

  if coalesce(cardinality(matched_ids), 0) > 1 then
    raise exception 'Ambiguous phone match: % contacts', cardinality(matched_ids) using errcode = '21000';
  end if;
  target_contact_id := matched_ids[1];

  if target_contact_id is not null and exists (
    select 1 from public.contacts c where c.id = target_contact_id and c.deleted_at is not null
  ) then
    raise exception 'Phone resolves to deleted contact' using errcode = '55006';
  end if;

  if target_contact_id is null then
    insert into public.contacts (full_name)
    values (coalesce(nullif(btrim(p_name), ''), 'Без имени'))
    returning id into target_contact_id;
    insert into public.contact_phones (contact_id, phone, is_primary)
    values (target_contact_id, normalized, true);
  end if;

  select d.id into target_deal_id
  from public.deals d
  where d.deleted_at is null
    and d.status not in ('won', 'lost')
    and (d.contact_id = target_contact_id or exists (
      select 1 from public.deal_contacts dc
      where dc.deal_id = d.id and dc.contact_id = target_contact_id
    ))
  order by d.created_at desc
  limit 1
  for update;

  if target_deal_id is null then
    select s.id into stage_id from public.stages s
    where s.is_active and s.kind = 'open' order by s.position limit 1;
    if stage_id is null then raise exception 'No active open stage'; end if;
    select s.id into source_id from public.sources s
    where s.code = 'web_form' and s.is_active limit 1;
    if source_id is null then raise exception 'No active web_form source'; end if;

    insert into public.deals (
      contact_id, stage_id, source_id, title, utm, meta_campaign_id,
      first_inbound_at, intake_event_id
    ) values (
      target_contact_id, stage_id, source_id,
      case when nullif(btrim(p_name), '') is not null then 'Форма сайта: ' || btrim(p_name) else 'Форма сайта' end,
      coalesce(p_utm, '{}'::jsonb), p_meta_campaign_id, now(), p_event_id
    ) returning id into target_deal_id;
  else
    insert into public.notes (deal_id, body, intake_event_id)
    values (target_deal_id, coalesce(nullif(p_comment, ''), 'Обращение с формы сайта (повторное обращение)'), p_event_id);
  end if;

  insert into public.deal_contacts (deal_id, contact_id, is_primary)
  select d.id, target_contact_id, d.contact_id = target_contact_id
  from public.deals d
  where d.id = target_deal_id and d.deleted_at is null
  on conflict (deal_id, contact_id) do nothing;

  if p_comment is not null and btrim(p_comment) <> ''
     and not exists (select 1 from public.notes n where n.intake_event_id = p_event_id) then
    insert into public.notes (deal_id, body, intake_event_id)
    values (target_deal_id, p_comment, p_event_id);
  end if;

  for field_key, field_value in select key, value from jsonb_each(coalesce(p_unknown, '{}'::jsonb)) loop
    select d.id into target_field_id from public.custom_field_defs d
    where d.entity = 'deal' and d.key = field_key;
    if target_field_id is null then
      insert into public.custom_field_defs (entity, key, label, field_type, auto_created)
      values ('deal', field_key, coalesce(nullif(p_unknown_labels ->> field_key, ''), field_key), 'text', true)
      on conflict (entity, key) do update set key = excluded.key
      returning id into target_field_id;
      if target_field_id is null then
        select d.id into target_field_id from public.custom_field_defs d
        where d.entity = 'deal' and d.key = field_key;
      end if;
    end if;
    insert into public.custom_field_values (field_id, entity_id, value)
    values (target_field_id, target_deal_id, field_value)
    on conflict (field_id, entity_id) do update set value = excluded.value;
  end loop;

  update public.inbound_events
  set processed_at = now(), error = null
  where id = p_event_id;
  return jsonb_build_object('deal_id', target_deal_id, 'duplicate', false);
end;
$$;

revoke all on function public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb, jsonb) from public, authenticated, anon;
grant execute on function public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb, jsonb) to service_role;
