-- Atomic, service-role-only web-form intake.
-- This migration is intentionally not applied by the worker.

alter table public.deals
  add column intake_event_id uuid references public.inbound_events (id);
create unique index deals_intake_event_id_uidx
  on public.deals (intake_event_id)
  where intake_event_id is not null;

alter table public.notes
  add column intake_event_id uuid references public.inbound_events (id);
create unique index notes_intake_event_id_uidx
  on public.notes (intake_event_id)
  where intake_event_id is not null;

create or replace function public.process_web_form_event(
  p_event_id uuid,
  p_phone text,
  p_name text,
  p_comment text,
  p_utm jsonb,
  p_meta_campaign_id text,
  p_unknown jsonb
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
  phone_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
  matched_ids uuid[];
  contact_id uuid;
  deal_id uuid;
  stage_id uuid;
  source_id uuid;
  field_id uuid;
  field_key text;
  field_value text;
  open_deal record;
  created_field record;
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
    select d.id into deal_id from public.deals d where d.intake_event_id = p_event_id;
    if deal_id is null then
      select n.deal_id into deal_id from public.notes n where n.intake_event_id = p_event_id;
    end if;
    return jsonb_build_object('deal_id', deal_id, 'duplicate', true);
  end if;

  if normalized is null then
    raise exception 'Телефон не распознан' using errcode = '22023';
  end if;

  select array_agg(distinct coalesce(c.merged_into, c.id)) into matched_ids
  from public.contacts c
  where exists (
    select 1 from public.contact_phones cp
    where cp.contact_id = c.id
      and (cp.phone = normalized or right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail)
  ) or exists (
    select 1 from public.imported_contact_phones ip
    where ip.contact_id = c.id
      and ip.normalized_phone is not null
      and (ip.normalized_phone = normalized
        or right(regexp_replace(ip.normalized_phone, '\D', '', 'g'), 8) = phone_tail)
  );

  if coalesce(cardinality(matched_ids), 0) > 1 then
    raise exception 'Ambiguous phone match: % contacts', cardinality(matched_ids) using errcode = '21000';
  end if;
  contact_id := matched_ids[1];

  if contact_id is null then
    insert into public.contacts (full_name)
    values (coalesce(nullif(btrim(p_name), ''), 'Без имени'))
    returning id into contact_id;
    insert into public.contact_phones (contact_id, phone, is_primary)
    values (contact_id, normalized, true);
  end if;

  select d.id into deal_id
  from public.deals d
  where d.contact_id = contact_id and d.status not in ('won', 'lost')
  order by d.created_at desc
  limit 1
  for update;

  if deal_id is null then
    select id into stage_id from public.stages
    where is_active and kind = 'open' order by position limit 1;
    if stage_id is null then raise exception 'No active open stage'; end if;
    select id into source_id from public.sources
    where code = 'web_form' and is_active limit 1;
    if source_id is null then raise exception 'No active web_form source'; end if;

    insert into public.deals (
      contact_id, stage_id, source_id, title, utm, meta_campaign_id,
      first_inbound_at, intake_event_id
    ) values (
      contact_id, stage_id, source_id,
      case when nullif(btrim(p_name), '') is not null then 'Форма сайта: ' || btrim(p_name) else 'Форма сайта' end,
      coalesce(p_utm, '{}'::jsonb), p_meta_campaign_id,
      now(), p_event_id
    ) returning id into deal_id;
  else
    insert into public.notes (deal_id, body, intake_event_id)
    values (deal_id, coalesce(nullif(p_comment, ''), 'Обращение с формы сайта (повторное обращение)'), p_event_id);
  end if;

  if deal_id is not null and p_comment is not null and btrim(p_comment) <> ''
     and not exists (select 1 from public.notes where intake_event_id = p_event_id) then
    insert into public.notes (deal_id, body, intake_event_id)
    values (deal_id, p_comment, p_event_id);
  end if;

  for field_key, field_value in select key, value from jsonb_each_text(coalesce(p_unknown, '{}'::jsonb)) loop
    select id into field_id from public.custom_field_defs
    where entity = 'deal' and key = field_key;
    if field_id is null then
      insert into public.custom_field_defs (entity, key, label, field_type, auto_created)
      values ('deal', field_key, field_key, 'text', true)
      on conflict (entity, key) do update set key = excluded.key
      returning id into field_id;
      if field_id is null then
        select id into field_id from public.custom_field_defs where entity = 'deal' and key = field_key;
      end if;
    end if;
    insert into public.custom_field_values (field_id, entity_id, value)
    values (field_id, deal_id, to_jsonb(field_value))
    on conflict (field_id, entity_id) do update set value = excluded.value;
  end loop;

  update public.inbound_events
  set processed_at = now(), error = null
  where id = p_event_id;
  return jsonb_build_object('deal_id', deal_id, 'duplicate', false);
end;
$$;

revoke all on function public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb) from public, authenticated, anon;
grant execute on function public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb) to service_role;
