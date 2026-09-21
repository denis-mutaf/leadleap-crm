-- Экран контактов открывался несколько секунд по двум причинам.
--
-- Первая: can_see_contact() вызывается для каждой из 5932 строк, а внутри
-- ещё раз читает profiles и settings. Для руководителя и администратора
-- ответ один и тот же на весь запрос, но Postgres об этом не знает.
-- Скалярный подзапрос превращает общую проверку в InitPlan — она считается
-- один раз за запрос. Так уже устроена политика deals_read. Смысл правил
-- не меняется: построчная проверка остаётся второй веткой ИЛИ.
--
-- Вторая: последняя активность собиралась объединением заметок и звонков
-- на лету. Теперь она хранится в контакте и поддерживается триггерами.

alter table public.contacts
  add column if not exists last_activity_at timestamptz;

create index if not exists contacts_last_activity_idx
  on public.contacts (last_activity_at desc nulls last);

create or replace function public.bump_contact_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
  moment timestamptz;
begin
  if tg_table_name = 'notes' then
    target := coalesce(new.contact_id, (select d.contact_id from deals d where d.id = new.deal_id));
    moment := new.created_at;
  else
    target := coalesce(new.contact_id, (select d.contact_id from deals d where d.id = new.deal_id));
    moment := new.started_at;
  end if;

  if target is null or moment is null then
    return new;
  end if;

  update contacts c
     set last_activity_at = moment
   where c.id = target
     and (c.last_activity_at is null or c.last_activity_at < moment);

  return new;
end;
$$;

drop trigger if exists notes_bump_contact_activity on public.notes;
create trigger notes_bump_contact_activity
  after insert or update of created_at, contact_id, deal_id on public.notes
  for each row execute function public.bump_contact_activity();

drop trigger if exists calls_bump_contact_activity on public.calls;
create trigger calls_bump_contact_activity
  after insert or update of started_at, contact_id, deal_id on public.calls
  for each row execute function public.bump_contact_activity();

with activity as (
  select s.contact_id, max(s.at) as at
  from (
    select coalesce(n.contact_id, d.contact_id) as contact_id, n.created_at as at
      from notes n
      left join deals d on d.id = n.deal_id
     where n.deleted_at is null
    union all
    select coalesce(cl.contact_id, d.contact_id), cl.started_at
      from calls cl
      left join deals d on d.id = cl.deal_id
  ) s
  where s.contact_id is not null
  group by s.contact_id
)
update public.contacts c
   set last_activity_at = activity.at
  from activity
 where activity.contact_id = c.id
   and c.last_activity_at is distinct from activity.at;

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts
  for select
  using (
    deleted_at is null
    and (select public.my_role()) = any (array['manager', 'head', 'admin']::user_role[])
    and (
      (select public.sees_everything())
      or public.can_see_contact(id)
    )
  );

drop policy if exists contact_phones_read on public.contact_phones;
create policy contact_phones_read on public.contact_phones
  for select
  using (
    (select public.my_role()) = any (array['manager', 'head', 'admin']::user_role[])
    and (
      (
        (select public.sees_everything())
        and exists (
          select 1 from public.contacts c
          where c.id = contact_phones.contact_id and c.deleted_at is null
        )
      )
      or public.can_see_contact(contact_phones.contact_id)
    )
  );

drop policy if exists contact_emails_read on public.contact_emails;
create policy contact_emails_read on public.contact_emails
  for select
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
