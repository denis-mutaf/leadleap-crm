-- Смоук тикета 57 (канбан, метки, активность пользователей). Прогнать ПОСЛЕ
-- применения миграций 20261006200000 и 20261006210000. BEGIN…ROLLBACK, без DDL.
-- Ожидаемо: последняя строка 'OK: qa-57'.
begin;

-- 1. Метки уникальны без учёта регистра и крайних пробелов.
do $$
declare t1 uuid;
begin
  insert into public.tags (name) values ('SMOKE-57 Тест') returning id into t1;
  begin
    insert into public.tags (name) values ('smoke-57 тест ');
    raise exception 'FAIL 1: дубль метки в другом регистре вставился';
  exception when unique_violation then
    null; -- ожидаемо
  end;
end $$;

-- 2. Активность пользователей читается сервисной ролью и закрыта для клиентов.
do $$
begin
  if has_function_privilege('authenticated', 'public.crm_users_last_seen()', 'execute') then
    raise exception 'FAIL 2: crm_users_last_seen доступна authenticated';
  end if;
  if has_function_privilege('anon', 'public.crm_users_last_seen()', 'execute') then
    raise exception 'FAIL 2: crm_users_last_seen доступна anon';
  end if;
  if not has_function_privilege('service_role', 'public.crm_users_last_seen()', 'execute') then
    raise exception 'FAIL 2: crm_users_last_seen недоступна service_role';
  end if;
  perform * from public.crm_users_last_seen();
end $$;

-- 3. Данные для доски: три сделки без ответственного (колонка «Общий котёл»).
do $$
declare
  c uuid; s uuid; tg uuid; a uuid; b uuid; x uuid;
begin
  select id into s from public.stages where kind = 'open' and is_active order by position limit 1;
  select id into tg from public.tags where name = 'SMOKE-57 Тест';
  insert into public.contacts (full_name) values ('SMOKE-57') returning id into c;
  -- 23:30 по Кишинёву 15 марта 2020 (UTC+2) — внутри суток 15-го, хотя в UTC это тоже 15-е;
  -- 00:30 16-го по Кишинёву — уже вне периода, хотя в UTC это всё ещё 15-е 22:30.
  insert into public.deals (contact_id, stage_id, created_at) values (c, s, '2020-03-15 23:30:00+02') returning id into a;
  insert into public.deals (contact_id, stage_id, created_at) values (c, s, '2020-03-16 00:30:00+02') returning id into b;
  insert into public.deals (contact_id, stage_id, created_at) values (c, s, '2020-03-15 12:00:00+02') returning id into x;
  insert into public.deal_tags (deal_id, tag_id) values (a, tg), (b, tg);
  -- id'ы переживают смену роли в настройках транзакции (временных таблиц не заводим).
  perform set_config('smoke57.a', a::text, true);
  perform set_config('smoke57.b', b::text, true);
  perform set_config('smoke57.tag', tg::text, true);
end $$;

select set_config('request.jwt.claim.sub', (
  select id::text from public.profiles
  where role = 'admin' and is_active order by id limit 1
), true);
set local role authenticated;

do $$
declare
  tg uuid; a uuid; b uuid; r jsonb; col jsonb; ids jsonb;
begin
  tg := current_setting('smoke57.tag')::uuid;
  a := current_setting('smoke57.a')::uuid;
  b := current_setting('smoke57.b')::uuid;

  -- 3a. Мультивыбор меток: обе сделки с меткой, без неё — нет.
  r := public.crm_board(p_tags => array[tg]);
  if (r->>'total')::int <> 2 then raise exception 'FAIL 3a: total=% (ждали 2)', r->>'total'; end if;

  -- 3b. Период по дате создания, границы включительно, по Кишинёву.
  r := public.crm_board(p_tags => array[tg], p_created_from => '2020-03-15', p_created_to => '2020-03-15');
  if (r->>'total')::int <> 1 then raise exception 'FAIL 3b: total=% (ждали 1)', r->>'total'; end if;
  col := r->'columns'->'kettle';
  if col is null or col->'deals'->0->>'id' <> a::text then
    raise exception 'FAIL 3b: в периоде ждали сделку a, пришло %', col;
  end if;

  -- 3c. Только «с»: захватывает обе.
  r := public.crm_board(p_tags => array[tg], p_created_from => '2020-03-15');
  if (r->>'total')::int <> 2 then raise exception 'FAIL 3c: total=%', r->>'total'; end if;

  -- 3d. Страница одной колонки: вторая страница по одной карточке — другая сделка.
  r := public.crm_board(p_page => 0, p_page_size => 1, p_tags => array[tg], p_column => 'kettle');
  ids := jsonb_build_array(r->'columns'->'kettle'->'deals'->0->>'id');
  r := public.crm_board(p_page => 1, p_page_size => 1, p_tags => array[tg], p_column => 'kettle');
  if jsonb_array_length(r->'columns'->'kettle'->'deals') <> 1 then
    raise exception 'FAIL 3d: на второй странице колонки не одна карточка: %', r->'columns'->'kettle';
  end if;
  if ids->>0 = r->'columns'->'kettle'->'deals'->0->>'id' then
    raise exception 'FAIL 3d: вторая страница повторила первую';
  end if;
  if (r->'columns'->'kettle'->>'total')::int <> 2 then
    raise exception 'FAIL 3d: total колонки % (ждали 2)', r->'columns'->'kettle'->>'total';
  end if;

  -- 3e. Без новых параметров доска отвечает как раньше (старый клиент).
  r := public.crm_board(p_page => 0, p_page_size => 1);
  if r->'columns' is null or r->'counters' is null then
    raise exception 'FAIL 3e: доска без фильтров пришла без columns/counters';
  end if;
end $$;

select 'OK: qa-57' as result;
rollback;
