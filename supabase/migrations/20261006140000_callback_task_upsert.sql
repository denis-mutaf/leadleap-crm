-- QA B-06 / тикет 50: на один контакт — не больше одной открытой автозадачи
-- «Перезвонить». На проде накопилось 60 открытых, из них 27 — дубли
-- (13 контактов, максимум 7 штук на одного). Новый пропущенный должен
-- сдвигать срок существующей задачи, а не плодить новую.
--
-- Что делает файл:
--   1. Разовая чистка: у контакта оставляем самую свежую открытую «Перезвонить»,
--      остальные закрываем как дубль (done_at + result_text), не удаляем.
--      Задачи Amo (amo_id) и ручные (is_auto = false) не трогаем.
--   2. Частичный уникальный индекс — защита на уровне базы.
--   3. upsert_callback_task() — атомарный «создать или сдвинуть срок».
--   4. overdue_callback_tasks() — точка расширения под эскалацию просрочки
--      руководителю (правила SLA — тикет 39, пока только выборка).

-- 1. Чистка дублей ---------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by contact_id
           order by created_at desc, id desc
         ) as rn
    from public.tasks
   where title = 'Перезвонить'
     and is_auto
     and amo_id is null
     and done_at is null
     and deleted_at is null
     and contact_id is not null
)
update public.tasks t
   set done_at = now(),
       result_text = 'Дубль: закрыта при чистке автозадач «Перезвонить»'
  from ranked r
 where t.id = r.id
   and r.rn > 1;

-- 2. Защита от новых дублей ------------------------------------------------
create unique index if not exists tasks_one_open_callback_per_contact
  on public.tasks (contact_id)
  where title = 'Перезвонить'
    and is_auto
    and done_at is null
    and deleted_at is null;

comment on index public.tasks_one_open_callback_per_contact is
  'Одна открытая автозадача «Перезвонить» на контакт; новый пропущенный сдвигает срок через upsert_callback_task()';

-- 3. Upsert ----------------------------------------------------------------
-- Зовёт вебхук АТС с сервисным ключом. Возвращает id открытой задачи.
-- При повторном пропущенном срок переносится на новый, ответственный и
-- сделка обновляются (если сделки сейчас нет — остаётся прежняя).
create or replace function public.upsert_callback_task(
  p_contact_id  uuid,
  p_deal_id     uuid,
  p_assignee_id uuid,
  p_type_id     uuid,
  p_due_at      timestamptz
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  task_id uuid;
begin
  insert into public.tasks (deal_id, contact_id, assignee_id, type_id, title, due_at, is_auto)
  values (p_deal_id, p_contact_id, p_assignee_id, p_type_id, 'Перезвонить', p_due_at, true)
  on conflict (contact_id)
    where title = 'Перезвонить' and is_auto and done_at is null and deleted_at is null
  do update set
    due_at      = excluded.due_at,
    assignee_id = coalesce(excluded.assignee_id, public.tasks.assignee_id),
    deal_id     = coalesce(excluded.deal_id, public.tasks.deal_id),
    type_id     = coalesce(excluded.type_id, public.tasks.type_id)
  returning id into task_id;
  return task_id;
end;
$fn$;

revoke all on function public.upsert_callback_task(uuid, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.upsert_callback_task(uuid, uuid, uuid, uuid, timestamptz)
  to service_role;

-- 4. Точка расширения: эскалация ------------------------------------------
-- Открытые «Перезвонить», просроченные дольше p_overdue. Порог и получателя
-- (руководитель) задаст тикет 39; сама эскалация не включена.
create or replace function public.overdue_callback_tasks(p_overdue interval)
returns setof public.tasks
language sql stable
set search_path = public, pg_temp
as $fn$
  select t.*
    from public.tasks t
   where t.title = 'Перезвонить'
     and t.is_auto
     and t.done_at is null
     and t.deleted_at is null
     and t.due_at < now() - p_overdue
   order by t.due_at;
$fn$;

revoke all on function public.overdue_callback_tasks(interval)
  from public, anon, authenticated;
grant execute on function public.overdue_callback_tasks(interval) to service_role;
