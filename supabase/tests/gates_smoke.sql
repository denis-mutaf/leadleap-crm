-- Проверка гейтов воронки на живой базе. Запускать под postgres
-- (Management API /database/query или psql). Тестовые контакт и сделка
-- удаляются в конце блока вместе со своим следом в audit_log.
-- Ожидаемый вывод: пять строк со словом OK, ни одной ошибки.
-- Нужен хотя бы один сотрудник в profiles: на него вешается задача.
create temp table if not exists smoke_log (n serial, line text);
truncate smoke_log;

do $$
declare
  c_id     uuid;
  d_id     uuid;
  st_new   uuid;
  st_qual  uuid;
  st_pres  uuid;
  st_lost  uuid;
  reason   uuid;
  n        int;
  task_ids uuid[];
begin
  select id into st_new  from stages where name = 'Новое обращение';
  select id into st_qual from stages where name = 'Квалификация';
  select id into st_pres from stages where name = 'Презентация';
  select id into st_lost from stages where name = 'Отказ';
  select id into reason  from lost_reasons limit 1;

  insert into contacts (full_name) values ('Тест гейтов') returning id into c_id;
  insert into contact_phones (contact_id, phone) values (c_id, normalize_phone('060 123 456'));
  insert into deals (contact_id, stage_id) values (c_id, st_new) returning id into d_id;

  -- 1. Новое обращение → Квалификация: нужен следующий шаг, задачи нет → падает
  begin
    update deals set stage_id = st_qual where id = d_id;
    raise exception 'FAIL 1: переход без задачи прошёл';
  exception when check_violation then
    insert into smoke_log (line) values ('OK 1: без задачи не пускает: ' || sqlerrm);
  end;

  -- задача с датой
  insert into tasks (deal_id, assignee_id, title, due_at)
  values (d_id, (select id from profiles limit 1), 'Позвонить', now() + interval '1 day');

  update deals set stage_id = st_qual where id = d_id;
  insert into smoke_log (line) values ('OK 2: с задачей переход в Квалификацию прошёл');

  -- 2. Квалификация → Презентация без полей квалификации → падает
  begin
    update deals set stage_id = st_pres where id = d_id;
    raise exception 'FAIL 3: переход без квалификации прошёл';
  exception when check_violation then
    insert into smoke_log (line) values ('OK 3: без квалификации не пускает: ' || sqlerrm);
  end;

  update deals set budget = 65000, payment = 'mortgage', horizon = 'm3_6',
                   residency = 'local', rooms = 2, purpose = 'living'
  where id = d_id;
  update deals set stage_id = st_pres where id = d_id;
  insert into smoke_log (line) values ('OK 4: с квалификацией переход в Презентацию прошёл');

  -- 3. Закрытие как проигранной идёт без гейтов, но требует причину
  update deals set stage_id = st_lost, lost_reason_id = reason where id = d_id;
  if (select status from deals where id = d_id) <> 'lost' then
    raise exception 'FAIL 5: статус не стал lost';
  end if;

  select count(*) into n from stage_transitions where deal_id = d_id;
  -- insert + 3 перехода этапов = 4 строки
  if n <> 4 then
    raise exception 'FAIL 5: в stage_transitions % строк, ожидалось 4', n;
  end if;
  insert into smoke_log (line) values ('OK 5: история переходов: ' || n || ' строк, статус lost');

  -- уборка. Контакт от сделки каскадом не удаляется (осознанно: контакты не удаляют,
  -- а сливают), поэтому порядок: задачи → сделка → контакт → лог изменений.
  select array_agg(id) into task_ids from tasks where deal_id = d_id;
  delete from tasks where deal_id = d_id;
  delete from deals where id = d_id;
  delete from contacts where id = c_id;
  delete from audit_log where entity_id in (d_id, c_id) or entity_id = any (task_ids);
end;
$$;

select line from smoke_log order by n;
