-- Смоук тикета 50 (QA B-06): после применения 20261006140000_callback_task_upsert.sql.
-- Данные создаются внутри транзакции и откатываются. Любой провал — raise exception.
begin;

-- 0. После чистки дублей быть не должно.
do $$
begin
  if exists (
    select 1 from public.tasks
     where title = 'Перезвонить' and is_auto and done_at is null and deleted_at is null
     group by contact_id having count(*) > 1
  ) then
    raise exception 'FAIL 0: у контакта осталось больше одной открытой «Перезвонить»';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'tasks_one_open_callback_per_contact') then
    raise exception 'FAIL 0: нет уникального индекса';
  end if;
end $$;

-- 1. upsert: два пропущенных подряд дают одну задачу, срок сдвинут.
do $$
declare
  c uuid; p uuid; t1 uuid; t2 uuid; t3 uuid; n int; due2 timestamptz;
begin
  select id into p from public.profiles limit 1;
  insert into public.contacts (full_name) values ('SMOKE-50') returning id into c;

  t1 := public.upsert_callback_task(c, null, p, null, now() + interval '1 hour');
  t2 := public.upsert_callback_task(c, null, p, null, now() + interval '3 hours');
  if t1 <> t2 then raise exception 'FAIL 1: второй пропущенный создал новую задачу'; end if;

  select count(*), max(due_at) into n, due2
    from public.tasks where contact_id = c and title = 'Перезвонить' and done_at is null;
  if n <> 1 then raise exception 'FAIL 1: открытых задач %, ожидали 1', n; end if;
  if due2 < now() + interval '2 hours 59 minutes' then
    raise exception 'FAIL 1: срок не сдвинут (%)', due2;
  end if;

  -- 2. прямой insert дубля отклоняется индексом.
  begin
    insert into public.tasks (contact_id, assignee_id, title, due_at, is_auto)
    values (c, p, 'Перезвонить', now(), true);
    raise exception 'FAIL 2: дубль вставился';
  exception when unique_violation then
    null; -- ожидаемо
  end;

  -- 3. закрытую задачу upsert не воскрешает: рождается новая открытая.
  update public.tasks set done_at = now(), result_text = 'smoke' where id = t1;
  t3 := public.upsert_callback_task(c, null, p, null, now() + interval '1 hour');
  if t3 = t1 then raise exception 'FAIL 3: переиспользована закрытая задача'; end if;

  -- 4. точка расширения видит просроченную задачу.
  update public.tasks set due_at = now() - interval '5 hours' where id = t3;
  if not exists (select 1 from public.overdue_callback_tasks(interval '2 hours') where id = t3) then
    raise exception 'FAIL 4: overdue_callback_tasks не вернула просроченную задачу';
  end if;
  if exists (select 1 from public.overdue_callback_tasks(interval '10 hours') where id = t3) then
    raise exception 'FAIL 4: порог не учтён';
  end if;
end $$;

select 'OK: qa-50' as result;
rollback;
