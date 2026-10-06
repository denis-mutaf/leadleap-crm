-- Смоук тикета 47: гейты воронки на сервере. BEGIN…ROLLBACK, без DDL.
-- Ожидаемо: строка 'OK: qa-47'.
begin;
do $$
declare
  c uuid; d uuid; p uuid;
  s30 uuid; s40 uuid; s50 uuid; s90 uuid; s20 uuid;
  neq uuid; kv uuid;
begin
  select id into s20 from stages where import_key = 'amo:stage:20';
  select id into s30 from stages where import_key = 'amo:stage:30';
  select id into s40 from stages where import_key = 'amo:stage:40';
  select id into s50 from stages where import_key = 'amo:stage:50';
  select id into s90 from stages where import_key = 'amo:stage:90';
  select id into neq from tags where name = 'неквал';
  select id into kv  from tags where name = 'КВАЛ';
  select id into p from profiles where is_active limit 1;

  update stages set requires_next_step = false, requires_qualification = false;
  insert into contacts (full_name) values ('SMOKE-47') returning id into c;
  insert into deals (contact_id, stage_id) values (c, s20) returning id into d;

  -- 1. неквал: 20 → 30 можно, 30 → 50 нельзя, 30 → 40 (парковка) можно
  insert into deal_tags (deal_id, tag_id) values (d, neq);
  update deals set stage_id = s30 where id = d;
  begin
    update deals set stage_id = s90 where id = d;
    raise exception 'FAIL 1: неквал ушёл в Резервацию';
  exception when check_violation then null;
  end;
  update deals set stage_id = s40 where id = d;

  -- 2. гейт полей: пустые поля не пускают, текстовые поля засчитываются
  delete from deal_tags where deal_id = d;
  insert into deal_tags (deal_id, tag_id) values (d, kv);
  update deals set stage_id = s30 where id = d;
  update stages set requires_qualification = true where id = s50;
  begin
    update deals set stage_id = s50 where id = d;
    raise exception 'FAIL 2a: пустая квалификация прошла';
  exception when check_violation then null;
  end;
  update deals set budget = 50000, payment = (select payment from deals where payment is not null limit 1),
    purchase_timing_text = '3 месяца', residency_detail = 'диаспора',
    rooms = (select rooms from deals where rooms is not null limit 1),
    purpose = (select purpose from deals where purpose is not null limit 1)
   where id = d;
  update deals set stage_id = s50 where id = d;
  update stages set requires_qualification = false where id = s50;

  -- 3. следующий шаг: просроченная задача не считается, будущая — да
  update deals set stage_id = s30 where id = d;
  update stages set requires_next_step = true where id = s50;
  insert into tasks (deal_id, assignee_id, title, due_at) values (d, p, 'SMOKE', now() - interval '1 day');
  begin
    update deals set stage_id = s50 where id = d;
    raise exception 'FAIL 3a: просроченная задача сошла за следующий шаг';
  exception when check_violation then null;
  end;
  insert into tasks (deal_id, assignee_id, title, due_at) values (d, p, 'SMOKE', now() + interval '1 day');
  update deals set stage_id = s50 where id = d;
end $$;
select 'OK: qa-47' as result;
rollback;
