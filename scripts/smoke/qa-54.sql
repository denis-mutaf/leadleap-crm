-- Смоук тикета 54: валидация карточки, лента изменений, проект одиночным выбором,
-- «изменено» у примечаний. BEGIN…ROLLBACK, без DDL. Ожидаемо: строка 'OK: qa-54'.
-- Правки идут от менеджера (роль authenticated + jwt sub), создание данных — до
-- смены роли, проверка audit_log — после неё (менеджер audit_log не читает).
begin;
do $$
declare
  mgr uuid; other uuid;
  c uuid; d uuid; stage uuid; fld uuid; note_id uuid;
  t1 uuid; t2 uuid; pr1 uuid; pr2 uuid;
  feed jsonb; cnt int; was_edit timestamptz;
begin
  select id into mgr   from profiles where role = 'manager' and is_active order by full_name limit 1;
  select id into other from profiles where role = 'manager' and is_active and id <> mgr order by full_name limit 1;
  select id into stage from stages where kind = 'open' and is_active order by position limit 1;
  select id into t1 from tags where is_active and name not in ('КВАЛ', 'неквал') order by name limit 1;
  select id into t2 from tags where is_active and name not in ('КВАЛ', 'неквал') order by name offset 1 limit 1;
  select id into pr1 from projects where is_active order by code limit 1;
  select id into pr2 from projects where is_active order by code offset 1 limit 1;

  insert into contacts (full_name) values ('SMOKE-54') returning id into c;
  insert into deals (contact_id, stage_id, owner_id, title) values (c, stage, mgr, 'SMOKE-54 сделка') returning id into d;
  -- сделка «не только что заведена»: иначе триггер связей примет правки за создание
  update deals set created_at = now() - interval '1 hour' where id = d;
  insert into custom_field_defs (entity, key, label, field_type) values ('deal', 'smoke_54', 'SMOKE-поле', 'text') returning id into fld;
  insert into notes (deal_id, author_id, body) values (d, mgr, 'до правки') returning id into note_id;

  perform set_config('request.jwt.claim.sub', mgr::text, true);
  set local role authenticated;

  -- 1. валидация: отказы
  begin update deals set budget = -1 where id = d; raise exception 'FAIL 1a: отрицательный бюджет прошёл';
  exception when check_violation then null; end;
  begin update deals set rooms = 9 where id = d; raise exception 'FAIL 1b: комнатность 9 прошла';
  exception when check_violation then null; end;
  begin update deals set monthly_payment_text = 'абв șț не число' where id = d; raise exception 'FAIL 1c: мусор в платеже прошёл';
  exception when check_violation then null; end;
  begin update deals set down_payment_text = '30000-10000' where id = d; raise exception 'FAIL 1d: перевёрнутый диапазон прошёл';
  exception when check_violation then null; end;
  begin update deals set purchase_timing_text = '3 месяца' where id = d; raise exception 'FAIL 1e: срок не месяцем прошёл';
  exception when check_violation then null; end;
  begin update deals set residency_detail = 'в Молдове' where id = d; raise exception 'FAIL 1f: свободный текст «В стране» прошёл';
  exception when check_violation then null; end;
  begin update deals set desired_floor_text = '-3' where id = d; raise exception 'FAIL 1g: этаж -3 прошёл';
  exception when check_violation then null; end;

  -- 2. валидация: допустимое проходит
  update deals set budget = 120000, rooms = 3, monthly_payment_text = '800-1200', down_payment_text = '10%',
    purchase_timing_text = '2026-12', residency = 'local', residency_detail = null,
    desired_floor_text = '3-5', desired_area_text = '55-70', object_text = 'SMOKE-объект' where id = d;

  -- 3. метки, проект, пользовательское поле, ответственный
  insert into deal_tags (deal_id, tag_id) values (d, t1);
  insert into deal_tags (deal_id, tag_id) values (d, t2);
  delete from deal_tags where deal_id = d and tag_id = t2;
  perform set_deal_project(d, pr1);
  perform set_deal_project(d, pr2);
  select count(*) into cnt from deal_projects where deal_id = d;
  if cnt <> 1 then raise exception 'FAIL 3a: проект не одиночный, строк %', cnt; end if;
  insert into custom_field_values (field_id, entity_id, value) values (fld, d, to_jsonb('значение A'::text));
  update custom_field_values set value = to_jsonb('значение B'::text) where field_id = fld and entity_id = d;
  update deals set owner_id = null where id = d;
  update deals set owner_id = mgr where id = d;

  -- 4. менеджер читает ленту своей сделки
  feed := deal_change_feed(d);
  if jsonb_array_length(feed -> 'events') < 8 then
    raise exception 'FAIL 4a: в ленте мало событий: %', jsonb_array_length(feed -> 'events');
  end if;
  if not exists (select 1 from jsonb_array_elements(feed -> 'events') e where e -> 'changes' ? 'owner_id') then
    raise exception 'FAIL 4b: нет смены ответственного';
  end if;
  if not exists (select 1 from jsonb_array_elements(feed -> 'events') e where e -> 'changes' ? 'tags') then
    raise exception 'FAIL 4c: нет события по меткам';
  end if;
  if not exists (select 1 from jsonb_array_elements(feed -> 'events') e where e -> 'changes' ? 'project') then
    raise exception 'FAIL 4d: нет события по проекту';
  end if;
  if not exists (select 1 from jsonb_array_elements(feed -> 'events') e where e -> 'changes' ? 'custom:SMOKE-поле') then
    raise exception 'FAIL 4e: нет события по пользовательскому полю';
  end if;
  if not (feed -> 'names') ? mgr::text then raise exception 'FAIL 4f: нет имени автора в словаре'; end if;
  if exists (select 1 from jsonb_array_elements(feed -> 'events') e where e -> 'changes' ? 'stage_id') then
    raise exception 'FAIL 4g: в ленту попали технические поля';
  end if;

  -- 4b. таблица: поиск по названию, «_» не подстановка, фильтр по пользовательскому полю
  if not exists (select 1 from crm_deals_table(p_q => 'SMOKE-54 сдел') where id = d) then
    raise exception 'FAIL 4h: таблица не нашла сделку по названию';
  end if;
  if exists (select 1 from crm_deals_table(p_q => 'SMOKE_54') where id = d) then
    raise exception 'FAIL 4i: «_» сработал как подстановка';
  end if;
  if not exists (select 1 from crm_deals_table(p_cf => fld, p_cfv => 'значение B') where id = d) then
    raise exception 'FAIL 4j: фильтр по пользовательскому полю не нашёл сделку';
  end if;
  if exists (select 1 from crm_deals_table(p_cf => fld, p_cfv => 'нет такого') where id = d) then
    raise exception 'FAIL 4k: фильтр по полю пропустил чужое значение';
  end if;

  -- 5. чужую сделку менеджер не видит (в проде видимость «все» — на время теста «только свои»)
  reset role;
  update settings set value = '"own"'::jsonb where key = 'manager_visibility';
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  begin perform deal_change_feed(d); raise exception 'FAIL 5: лента чужой сделки открылась';
  exception when insufficient_privilege then null; end;

  -- 6. «изменено» у примечания: правка человеком ставит отметку
  perform set_config('request.jwt.claim.sub', mgr::text, true);
  update notes set body = 'после правки' where id = note_id;
  select edited_at into was_edit from notes where id = note_id;
  if was_edit is null then raise exception 'FAIL 6a: edited_at не поставлен'; end if;

  -- 7. без пользователя (импорт) валидация и отметка не мешают
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  update deals set budget = -5 where id = d;
  update notes set body = 'импорт', edited_at = null where id = note_id;
  select edited_at into was_edit from notes where id = note_id;
  if was_edit is not null then raise exception 'FAIL 7: импорт поставил «изменено»'; end if;

  -- 8. метки: ровно три события (добавил, добавил, снял)
  cnt := (select count(*) from audit_log where entity = 'deals' and entity_id = d and action = 'update' and changes ? 'tags');
  if cnt <> 3 then raise exception 'FAIL 8: ожидалось 3 события по меткам (добавил, добавил, снял), есть %', cnt; end if;
end $$;
select 'OK: qa-54' as result;
rollback;
