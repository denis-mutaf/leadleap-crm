-- QA 05.10.2026, участок B: контакты, телефоны, почта (тикет 49).
-- B-03 телефон любого вида приводится к E.164 триггером; B-05 вставка и удаление
-- почты контакта; B-15 слияние не плодит «основные» телефоны; B-17 для +373
-- ровно 8 цифр и подсказка, когда найденный контакт менеджеру не виден;
-- поиск контактов без учёта диакритики («Taran» находит «Țăran»).
-- Разовая нормализация уже записанных номеров — следующим файлом.

-- 1. Нормализация телефона. Добавлен международный префикс «00»: 00373… = +373….
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null then
    return null;
  end if;

  digits := regexp_replace(raw, '\D', '', 'g');

  if digits = '' then
    return null;
  end if;

  -- международный набор через 00: 00373 60 123 456
  if left(digits, 2) = '00' and length(digits) > 2 then
    return '+' || substr(digits, 3);
  end if;

  -- местный молдавский набор: 8 цифр, иногда с ведущим нулём
  if length(digits) = 8 then
    return '+373' || digits;
  end if;

  if length(digits) = 9 and left(digits, 1) = '0' then
    return '+373' || right(digits, 8);
  end if;

  -- международный номер как есть
  return '+' || digits;
end;
$$;

-- 2. Любая вставка или правка номера контакта проходит через normalize_phone.
-- Триггер мягкий: чинит формат, но не навязывает длину и не роняет запись
-- без цифр (скрытый номер на входящем звонке вебхук телефонии пишет как есть).
-- Пустой номер отклоняется. Длину и «+373 — ровно 8 цифр» проверяют форма и
-- create_crm_deal.
create or replace function public.contact_phones_normalize()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if nullif(btrim(new.phone), '') is null then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  new.phone := coalesce(public.normalize_phone(new.phone), btrim(new.phone));
  return new;
end;
$$;

drop trigger if exists contact_phones_normalize on public.contact_phones;
create trigger contact_phones_normalize
  before insert or update of phone on public.contact_phones
  for each row execute function public.contact_phones_normalize();

-- 3. Поиск без диакритики: нормализованная строка + trigram-индекс.
create or replace function public.crm_fold(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(lower(p_text), 'ăâîșşțţáàäåãçéèêëíìïñóòôöõúùûüýÿё', 'aaissttaaaaaceeeeiiinooooouuuuyyе');
$$;

create index if not exists contacts_fold_name_trgm_idx
  on public.contacts using gin (public.crm_fold(full_name) gin_trgm_ops)
  where merged_into is null;

-- 4. Почта контакта: те же правила видимости, что у чтения (политика
-- contact_emails_read). Общие проверки — через (select fn()), чтобы
-- планировщик считал их один раз на запрос, а не на каждую строку.
drop policy if exists contact_emails_insert on public.contact_emails;
create policy contact_emails_insert on public.contact_emails
  for insert to authenticated
  with check (
    (select public.my_role()) = any (array['manager', 'head', 'admin']::user_role[])
    and (
      (
        (select public.sees_everything())
        and exists (
          select 1 from public.contacts c
          where c.id = contact_emails.contact_id and c.deleted_at is null
        )
      )
      or public.can_see_contact(contact_emails.contact_id)
    )
  );

drop policy if exists contact_emails_delete on public.contact_emails;
create policy contact_emails_delete on public.contact_emails
  for delete to authenticated
  using (
    (select public.my_role()) = any (array['manager', 'head', 'admin']::user_role[])
    and (
      (
        (select public.sees_everything())
        and exists (
          select 1 from public.contacts c
          where c.id = contact_emails.contact_id and c.deleted_at is null
        )
      )
      or public.can_see_contact(contact_emails.contact_id)
    )
  );

-- Формат адреса. NOT VALID: уже записанные (импортированные) адреса не
-- проверяются, правило действует на новые вставки и правки.
alter table public.contact_emails
  drop constraint if exists contact_emails_email_format;
alter table public.contact_emails
  add constraint contact_emails_email_format
  check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$') not valid;

grant insert, delete on public.contact_emails to authenticated;

-- 5. Слияние: основной номер остаётся только у выжившего контакта (B-15).
-- Тело — как в боевой базе, добавлен только сброс is_primary у переносимых номеров.
create or replace function public.merge_crm_contacts(p_source_contact uuid, p_target_contact uuid, p_name_source uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- Основным остаётся номер выжившего контакта; номера второго переезжают обычными.
  update public.contact_phones set is_primary = false
    where contact_id = p_source_contact and is_primary;
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
$function$;

-- 6. Новая сделка: для +373 ровно 8 цифр после кода (11 цифр всего), а при
-- дубле — сколько найденных контактов менеджеру видно. visible_count = 0 значит
-- «контакт есть, но чужой»: выбрать в форме его нельзя, интерфейс скажет об этом.
create or replace function public.create_crm_deal(p_full_name text, p_phone text, p_source_id uuid, p_project_ids uuid[], p_stage_id uuid, p_title text, p_owner_id uuid, p_object_text text, p_tag_ids uuid[], p_note text, p_reuse_contact_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  if normalized like '+373%' and length(normalized) <> 12 then
    raise exception 'Moldova phone needs 8 digits' using errcode = '22023';
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
    return jsonb_build_object(
      'kind', 'duplicate',
      'count', cardinality(matched_ids),
      'visible_count', (select count(*) from unnest(matched_ids) m(id) where public.can_see_contact(m.id))
    );
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
$function$;

-- 7. Список контактов: имя без диакритики, номер в любом виде, % и _ в запросе
-- не работают как маска. Номер ищется по таблице contact_phones и
-- imported_contact_phones. Контракт и сортировка прежние.
create or replace function public.list_contacts_page(p_page integer default 0, p_page_size integer default 50, p_query text default null::text, p_sort text default 'name'::text)
 returns table(id uuid, full_name text, created_at timestamp with time zone, phone text, deal_count bigint, last_activity_at timestamp with time zone, total_count bigint)
 language sql
 stable
 set search_path to 'public'
as $function$
  with q as (
    select
      nullif(btrim(p_query), '') as raw,
      '%' || public.crm_fold(replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_')) || '%' as name_like,
      coalesce(btrim(p_query) ~ '^[0-9[:space:]+()-]+$', false)
        and length(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g')) >= 4 as is_phone,
      -- 069… → 37369…; для остальных ведущий «0» отбрасывается, чтобы
      -- 0600000002 нашёл +373600000002
      case
        when regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') ~ '^0[1-9]'
          and length(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g')) <> 9
          then substr(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), 2)
        else public.crm_phone_digits(p_query)
      end as digits
  ),
  visible as (
    select c.id, c.full_name, c.created_at, c.last_activity_at,
      count(*) over () as total_count
    from contacts c, q
    where c.deleted_at is null
      and c.merged_into is null
      and (
        q.raw is null
        or public.crm_fold(c.full_name) like q.name_like
        or (
          q.is_phone
          and (
            exists (
              select 1 from contact_phones cp
              where cp.contact_id = c.id
                and cp.phone like '%' || q.digits || '%'
            )
            or exists (
              select 1 from imported_contact_phones ip
              where ip.contact_id = c.id
                and ip.normalized_phone like '%' || q.digits || '%'
            )
          )
        )
      )
    order by
      case when p_sort = 'created'  then c.created_at end desc nulls last,
      case when p_sort = 'activity' then c.last_activity_at end desc nulls last,
      case when p_sort not in ('created', 'activity') then c.full_name end asc nulls last,
      c.id
    offset greatest(p_page, 0) * greatest(p_page_size, 1)
    limit greatest(p_page_size, 1)
  )
  -- Телефон и число сделок читаются только для полусотни строк страницы.
  select v.id, v.full_name, v.created_at,
    (select cp.phone from contact_phones cp
      where cp.contact_id = v.id
      order by cp.is_primary desc nulls last, cp.created_at
      limit 1) as phone,
    (select count(*) from deals d
      where d.contact_id = v.id and d.deleted_at is null) as deal_count,
    v.last_activity_at, v.total_count
  from visible v
  order by
    case when p_sort = 'created'  then v.created_at end desc nulls last,
    case when p_sort = 'activity' then v.last_activity_at end desc nulls last,
    case when p_sort not in ('created', 'activity') then v.full_name end asc nulls last,
    v.id;
$function$;

-- 8. Глобальный поиск: имя контакта без диакритики. Остальное — как было.
create or replace function public.crm_global_search(p_q text, p_limit integer default 8)
 returns table(kind text, id uuid, title text, meta text, deal_id uuid)
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q       text := btrim(coalesce(p_q, ''));
  lim     integer := least(greatest(coalesce(p_limit, 8), 1), 25);
  digits  text := public.crm_phone_digits(q);
  phone   boolean := q ~ '^[0-9\s+()\-]+$' and length(regexp_replace(q, '[^0-9]', '', 'g')) >= 4;
  like_q  text;
begin
  if length(q) < 2 then return; end if;
  like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with found_contacts as materialized (
    select c.id, c.full_name
    from contacts c
    where c.deleted_at is null
      and c.merged_into is null
      and (
        (phone and (
          exists (select 1 from contact_phones cp where cp.contact_id = c.id and cp.phone like '%' || digits || '%')
          or exists (select 1 from imported_contact_phones ip where ip.contact_id = c.id and ip.normalized_phone like '%' || digits || '%')
        ))
        or (not phone and public.crm_fold(c.full_name) like public.crm_fold(like_q))
      )
    order by c.last_activity_at desc nulls last
    limit lim
  ),
  found_deals as materialized (
    select d.id, d.title, d.object_text, d.stage_id, d.contact_id, d.updated_at
    from deals d
    where d.deleted_at is null
      and (
        (not phone and (d.title ilike like_q or d.object_text ilike like_q))
        or d.contact_id in (select fc.id from found_contacts fc)
        or exists (select 1 from deal_contacts dc where dc.deal_id = d.id and dc.contact_id in (select fc.id from found_contacts fc))
      )
    order by d.updated_at desc
    limit lim
  ),
  found_tasks as materialized (
    select t.id, t.title, t.due_at, t.deal_id
    from tasks t
    where t.done_at is null
      and t.deleted_at is null
      and (
        (not phone and t.title ilike like_q)
        or t.deal_id in (select fd.id from found_deals fd)
        or t.contact_id in (select fc.id from found_contacts fc)
      )
    order by t.due_at
    limit lim
  )
  select 'contact'::text, fc.id, coalesce(nullif(fc.full_name, ''), 'Без имени'),
    (select cp.phone from contact_phones cp where cp.contact_id = fc.id order by cp.is_primary desc, cp.created_at limit 1),
    null::uuid
  from found_contacts fc
  union all
  select 'deal'::text, fd.id, coalesce(nullif(fd.title, ''), nullif(fd.object_text, ''), 'Без названия'),
    (select s.name from stages s where s.id = fd.stage_id),
    fd.id
  from found_deals fd
  union all
  select 'task'::text, ft.id, ft.title, to_char(ft.due_at at time zone 'Europe/Chisinau', 'DD.MM.YYYY'), ft.deal_id
  from found_tasks ft;
end;
$function$;

-- 9. Поиск контакта для слияния (диалог «Объединить»): имя без диакритики.
-- SECURITY INVOKER — видимость режет RLS.
create or replace function public.crm_search_contacts(p_q text, p_exclude uuid default null, p_limit integer default 8)
 returns setof public.contacts
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select c.*
  from public.contacts c
  where c.deleted_at is null
    and c.merged_into is null
    and (p_exclude is null or c.id <> p_exclude)
    and length(btrim(coalesce(p_q, ''))) >= 2
    and public.crm_fold(c.full_name) like
      '%' || public.crm_fold(replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_')) || '%'
  order by c.full_name
  limit least(greatest(coalesce(p_limit, 8), 1), 25);
$function$;

grant execute on function public.crm_search_contacts(text, uuid, integer) to authenticated;
