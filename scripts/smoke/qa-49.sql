-- Smoke тикета 49 (контакты, телефоны, почта). Прогнать ПОСЛЕ применения миграций
-- 20261006120000 и 20261006130000: supabase db query --file scripts/smoke/qa-49.sql
-- Все созданные строки откатываются. DDL в транзакции нет.
begin;
select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where role = 'admin' and is_active order by id limit 1
), true);
set local role authenticated;

do $$
declare
  actor_id uuid := auth.uid();
  v_source uuid;
  v_project uuid;
  v_stage uuid;
  base text := lpad(floor(random() * 100000000000)::bigint::text, 11, '0');
  phone_a text := '+999' || base;
  phone_b_raw text := '+999 ' || substr(base, 1, 3) || ' ' || substr(base, 4, 3) || ' 77 ' || substr(base, 10, 2);
  phone_c text := '+998' || reverse(base);
  r jsonb;
  deal_a uuid;
  deal_c uuid;
  contact_a uuid;
  contact_c uuid;
  n integer;
  got text;
  manager_id uuid;
  caught boolean;
begin
  if actor_id is null then raise exception 'Нет активного admin для smoke'; end if;
  select id into v_source from public.sources where is_active order by id limit 1;
  select id into v_project from public.projects where is_active order by id limit 1;
  select id into v_stage from public.stages where is_active and kind = 'open' order by position limit 1;

  -- 1. normalize_phone: разные виды одного номера
  if public.normalize_phone('069 111 875') <> '+37369111875'
     or public.normalize_phone('+373 69 111 875') <> '+37369111875'
     or public.normalize_phone('00373 69111875') <> '+37369111875'
     or public.normalize_phone('69111875') <> '+37369111875'
     or public.normalize_phone('373-69-111-875') <> '+37369111875' then
    raise exception 'B-03: normalize_phone вернул неверный формат';
  end if;

  -- 2. Контакт через RPC, второй номер с пробелами — триггер нормализует
  r := public.create_crm_deal('QA B Контакт А Țăran', phone_a, v_source, array[v_project], v_stage,
    'QA B deal A', actor_id, null, '{}'::uuid[], null, null);
  if r ->> 'kind' <> 'created' then raise exception 'B-03: создание A: %', r; end if;
  deal_a := (r ->> 'deal_id')::uuid;
  select contact_id into contact_a from public.deals where id = deal_a;

  insert into public.contact_phones (contact_id, phone, is_primary)
  values (contact_a, phone_b_raw, false);
  select phone into got from public.contact_phones
    where contact_id = contact_a and not is_primary;
  if got !~ '^\+[0-9]+$' then
    raise exception 'B-03: доп. телефон не нормализован: %', got;
  end if;
  begin
    insert into public.contact_phones (contact_id, phone, is_primary) values (contact_a, '  ', false);
    raise exception 'B-03: пустой номер принят';
  exception when sqlstate '22023' then null;
  end;

  -- 3. Превью дубля и серверная проверка видят доп. номер в любом написании
  select count(*) into n from public.find_contacts_by_phone(phone_b_raw) where contact_id = contact_a;
  if n <> 1 then raise exception 'B-03: find_contacts_by_phone не нашёл по доп. номеру (с пробелами)'; end if;
  select count(*) into n from public.find_contacts_by_phone(replace(replace(phone_b_raw, ' ', ''), '+', '')) where contact_id = contact_a;
  if n <> 1 then raise exception 'B-03: find_contacts_by_phone не нашёл по доп. номеру (цифры)'; end if;

  r := public.create_crm_deal('QA B дубль', phone_b_raw, v_source, array[v_project], v_stage,
    'QA B dup', actor_id, null, '{}'::uuid[], null, null);
  if r ->> 'kind' <> 'duplicate' or coalesce((r ->> 'visible_count')::int, 0) < 1 then
    raise exception 'B-03/B-17: дубль по доп. номеру не найден или не виден: %', r;
  end if;
  r := public.create_crm_deal('QA B повтор', phone_b_raw, v_source, array[v_project], v_stage,
    'QA B reuse', actor_id, null, '{}'::uuid[], null, contact_a);
  if r ->> 'kind' <> 'created' then raise exception 'B-03: сделка выбранному контакту: %', r; end if;

  -- 4. B-17: +373 — ровно 8 цифр
  begin
    perform public.create_crm_deal('QA B длинный', '+373 60 000 00 01', v_source, array[v_project], v_stage,
      'QA B long', actor_id, null, '{}'::uuid[], null, null);
    raise exception 'B-17: +373 с 9 цифрами принят';
  exception when sqlstate '22023' then
    if sqlerrm <> 'Moldova phone needs 8 digits' then raise; end if;
  end;

  -- 5. B-15: после слияния основной номер один — у выжившего
  r := public.create_crm_deal('QA B Контакт C', phone_c, v_source, array[v_project], v_stage,
    'QA B deal C', actor_id, null, '{}'::uuid[], null, null);
  deal_c := (r ->> 'deal_id')::uuid;
  select contact_id into contact_c from public.deals where id = deal_c;
  perform public.merge_crm_contacts(contact_c, contact_a, null);
  select count(*) into n from public.contact_phones where contact_id = contact_a and is_primary;
  if n <> 1 then raise exception 'B-15: основных номеров после слияния %, ожидался 1', n; end if;
  select phone into got from public.contact_phones where contact_id = contact_a and is_primary;
  if got <> phone_a then raise exception 'B-15: основной номер не от выжившего: %', got; end if;
  if not exists (select 1 from public.contact_phones where contact_id = contact_a and phone = phone_c and not is_primary) then
    raise exception 'B-15: номер второго контакта не перенесён обычным';
  end if;

  -- 6. B-05: почта — вставка, формат, удаление
  insert into public.contact_emails (contact_id, ordinal, email) values (contact_a, 0, 'qa_b@example.com');
  caught := false;
  begin
    insert into public.contact_emails (contact_id, ordinal, email) values (contact_a, 1, 'not-an-email');
  exception when check_violation then caught := true;
  end;
  if not caught then raise exception 'B-05: некорректная почта принята'; end if;
  delete from public.contact_emails where contact_id = contact_a and ordinal = 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B-05: почта не удалилась'; end if;

  -- 6b. менеджер без доступа к чужому контакту почту добавить не может
  select p.id into manager_id from public.profiles p
    where p.role = 'manager' and p.is_active and p.id <> actor_id order by p.id limit 1;
  if manager_id is not null then
    perform set_config('request.jwt.claim.sub', manager_id::text, true);
    if not public.can_see_contact(contact_a) then
      caught := false;
      begin
        insert into public.contact_emails (contact_id, ordinal, email) values (contact_a, 5, 'qa_b2@example.com');
      exception when insufficient_privilege then caught := true;
      end;
      if not caught then raise exception 'B-05: менеджер добавил почту чужому контакту'; end if;
    end if;
    perform set_config('request.jwt.claim.sub', actor_id::text, true);
  end if;

  -- 7. Поиск без диакритики и по номеру в любом виде
  select count(*) into n from public.list_contacts_page(0, 50, 'контакт а taran', 'name') where id = contact_a;
  if n <> 1 then raise exception 'Поиск: «taran qa» не нашёл «Țăran» в списке контактов'; end if;
  select count(*) into n from public.list_contacts_page(0, 50, phone_b_raw, 'name') where id = contact_a;
  if n <> 1 then raise exception 'Поиск: контакт не найден по доп. номеру с пробелами'; end if;
  select count(*) into n from public.crm_search_contacts('TARAN', null, 8) where id = contact_a;
  if n <> 1 then raise exception 'Поиск для слияния: «TARAN» не нашёл «Țăran»'; end if;
  select count(*) into n from public.crm_global_search('контакт а taran') where kind = 'contact' and id = contact_a;
  if n <> 1 then raise exception 'Глобальный поиск: «taran qa» не нашёл «Țăran»'; end if;

  raise notice 'qa-49 smoke: OK';
  perform 1;
end;
$$;
select 'OK: qa-49' as result;
rollback;
