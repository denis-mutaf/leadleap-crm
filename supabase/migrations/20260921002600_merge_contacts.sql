-- Атомарное ручное слияние контактов.
-- Контракт: merge_crm_contacts(p_source_contact, p_target_contact,
-- p_name_source). p_source_contact явно поглощается p_target_contact; UUID
-- не могут совпадать, быть уже merged или образовывать цикл. p_name_source
-- может быть только одним из двух UUID и определяет full_name target.
--
-- Переносятся на target: deals.contact_id, deal_contacts, contact_phones,
-- imported_contact_phones, contact_emails, contact_channels, contact_tags,
-- tasks, notes, calls, conversations и notifications. Соответствующие deal
-- rows сохраняются; messages следуют за conversations. custom_field_values
-- для contact entity копируются на target; differing target values fail closed
-- до любых изменений и требуют явного выбора. audit_log не
-- изменяется: entity/entity_id не имеют FK и не позволяют доказать тип UUID;
-- ссылки source остаются валидной историей. Не переносятся: inbound_events,
-- notification_rules, custom_field_defs, profiles, dictionaries, deal-level
-- custom_field_values/deal_tags/deal_projects/stage_transitions и amo import
-- rows без contact_id; они уже относятся к сохранённым deal или не имеют
-- контактной связи. Global unique conflicts fail closed; identical semantic
-- links are coalesced only where explicitly handled (deal_contacts,
-- conversations). Imported ordinals are remapped to free smallint values.
-- contact_tags uses UPDATE for non-overlap (so tag_id active trigger does not
-- run); overlap keeps target and deletes only the duplicate source row.
-- UPDATE deals.contact_id fires deals_touch and changes updated_at to now();
-- this may affect sorting/reports. Avoiding it without disabling the trigger
-- is not possible in this RPC; this remains a root-level risk.
-- Любая ошибка откатывает всю функцию.
-- source contact не удаляется и получает merged_into=target.

create or replace function public.merge_crm_contacts(
  p_source_contact uuid,
  p_target_contact uuid,
  p_name_source uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.contacts%rowtype;
  v_target public.contacts%rowtype;
  v_ordinal integer;
  v_row record;
begin
  if auth.uid() is null
     or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false)
     or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
     or not public.can_see_contact(p_source_contact)
     or not public.can_see_contact(p_target_contact) then
    raise exception 'contact merge requires an authenticated manager, head, or admin';
  end if;
  if p_source_contact is null or p_target_contact is null
     or p_source_contact = p_target_contact then
    raise exception 'source and target contacts must be distinct non-null UUIDs';
  end if;
  if p_name_source is not null
     and p_name_source not in (p_source_contact, p_target_contact) then
    raise exception 'name source must be source or target contact';
  end if;

  -- Один порядок блокировок для параллельных обратных вызовов.
  perform 1 from public.contacts
    where id in (p_source_contact, p_target_contact)
    order by id for update;
  select * into v_source from public.contacts where id = p_source_contact;
  select * into v_target from public.contacts where id = p_target_contact;
  if not found or v_source.id is null then
    raise exception 'source or target contact not found';
  end if;
  if v_source.merged_into is not null or v_target.merged_into is not null then
    raise exception 'source and target must be unmerged contacts';
  end if;
  if exists (select 1 from public.custom_field_values s
    join public.custom_field_defs f on f.id = s.field_id and f.entity = 'contact'
    join public.custom_field_values t on t.field_id = s.field_id and t.entity_id = p_target_contact
    where s.entity_id = p_source_contact and s.value is distinct from t.value) then
    raise exception 'contact custom field conflict requires explicit value selection';
  end if;

  if p_name_source = p_source_contact then
    update public.contacts set full_name = v_source.full_name where id = p_target_contact;
  end if;

  update public.deals set contact_id = p_target_contact
    where contact_id = p_source_contact;

  update public.deal_contacts t set is_primary = t.is_primary or s.is_primary
    from public.deal_contacts s
    where s.contact_id = p_source_contact and t.contact_id = p_target_contact
      and t.deal_id = s.deal_id;
  delete from public.deal_contacts where contact_id = p_source_contact
    and exists (select 1 from public.deal_contacts d where d.deal_id = deal_contacts.deal_id
                and d.contact_id = p_target_contact);
  update public.deal_contacts set contact_id = p_target_contact
    where contact_id = p_source_contact;

  update public.contact_phones set contact_id = p_target_contact
    where contact_id = p_source_contact;

  update public.contact_channels set contact_id = p_target_contact
    where contact_id = p_source_contact;

  delete from public.contact_tags where contact_id = p_source_contact
    and exists (select 1 from public.contact_tags t
               where t.contact_id = p_target_contact and t.tag_id = contact_tags.tag_id);
  update public.contact_tags set contact_id = p_target_contact
    where contact_id = p_source_contact;

  update public.tasks set contact_id = p_target_contact where contact_id = p_source_contact;
  update public.notes set contact_id = p_target_contact where contact_id = p_source_contact;
  update public.calls set contact_id = p_target_contact where contact_id = p_source_contact;
  for v_row in select s.id source_id, t.id target_id
    from public.conversations s join public.conversations t
      on t.contact_id = p_target_contact and t.channel = s.channel
     and t.external_thread_id = s.external_thread_id
    where s.contact_id = p_source_contact loop
    update public.messages set conversation_id = v_row.target_id
      where conversation_id = v_row.source_id;
    delete from public.conversations where id = v_row.source_id;
  end loop;
  update public.conversations set contact_id = p_target_contact where contact_id = p_source_contact;
  update public.notifications set contact_id = p_target_contact where contact_id = p_source_contact;

  for v_row in select * from public.imported_contact_phones
    where contact_id = p_source_contact order by ordinal, raw_phone loop
    if not exists (select 1 from public.imported_contact_phones
                   where contact_id = p_target_contact and ordinal = v_row.ordinal) then
      update public.imported_contact_phones set contact_id = p_target_contact
        where contact_id = p_source_contact and ordinal = v_row.ordinal;
    else
      select coalesce(max(ordinal), 0) + 1 into v_ordinal
        from public.imported_contact_phones where contact_id = p_target_contact;
      if v_ordinal > 32767 then raise exception 'imported phone ordinal overflow'; end if;
      update public.imported_contact_phones set contact_id = p_target_contact, ordinal = v_ordinal
        where contact_id = p_source_contact and ordinal = v_row.ordinal;
    end if;
  end loop;
  for v_row in select * from public.contact_emails
    where contact_id = p_source_contact order by ordinal, email loop
    if not exists (select 1 from public.contact_emails
                   where contact_id = p_target_contact and ordinal = v_row.ordinal) then
      update public.contact_emails set contact_id = p_target_contact
        where contact_id = p_source_contact and ordinal = v_row.ordinal;
    else
      select coalesce(max(ordinal), 0) + 1 into v_ordinal
        from public.contact_emails where contact_id = p_target_contact;
      if v_ordinal > 32767 then raise exception 'contact email ordinal overflow'; end if;
      update public.contact_emails set contact_id = p_target_contact, ordinal = v_ordinal
        where contact_id = p_source_contact and ordinal = v_row.ordinal;
    end if;
  end loop;

  insert into public.custom_field_values (field_id, entity_id, value)
    select field_id, p_target_contact, value from public.custom_field_values v
    join public.custom_field_defs f on f.id = v.field_id and f.entity = 'contact'
    where v.entity_id = p_source_contact on conflict (field_id, entity_id) do nothing;

  update public.contacts set merged_into = p_target_contact where id = p_source_contact;
end;
$$;

revoke all on function public.merge_crm_contacts(uuid, uuid, uuid) from public;
grant execute on function public.merge_crm_contacts(uuid, uuid, uuid) to authenticated;

comment on function public.merge_crm_contacts(uuid, uuid, uuid) is
  'Atomic manual contact merge. Authenticated manager/head/admin only; builder forbidden. See migration header for full transfer contract.';
