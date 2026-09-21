-- Правило видимости вызывалось на каждую строку списка и каждый счётчик, а
-- начиналось с самой дорогой проверки — обхода контактов, сделок и связей.
-- У переписки из мессенджера контакта нет вовсе, поэтому дорогой ветке там
-- делать нечего: CASE обрывает проверку на дешёвом условии.
create or replace function public.can_see_conversation(
  target_contact uuid, target_assignee uuid
) returns boolean language sql stable security definer
set search_path = public, pg_temp as $fn$
  select public.my_role() in ('manager', 'head', 'admin')
     and case
           when target_contact is null then
             target_assignee is null
             or target_assignee = auth.uid()
             or public.sees_everything()
           else public.can_see_contact(target_contact)
         end;
$fn$;
