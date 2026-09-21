-- Переписка из мессенджера приходит раньше, чем у неё появляется контакт:
-- человек написал «здравствуйте», и карточки под ним ещё нет. Старое правило
-- видимости требовало контакт всегда, поэтому такие диалоги не видел никто —
-- включая 229 перенесённых из Facebook. Безхозный диалог показывается всем
-- менеджерам, пока его никто не взял; взятый — ответственному и руководству.
create or replace function public.can_see_conversation(
  target_contact uuid, target_assignee uuid
) returns boolean language sql stable security definer
set search_path = public, pg_temp as $fn$
  select public.my_role() in ('manager', 'head', 'admin')
     and (
       public.can_see_contact(target_contact)
       or (
         target_contact is null
         and (
           target_assignee is null
           or public.sees_everything()
           or target_assignee = auth.uid()
         )
       )
     );
$fn$;

drop policy if exists conversations_all on public.conversations;
create policy conversations_all on public.conversations for all to authenticated
  using (public.can_see_conversation(contact_id, assigned_to))
  with check (public.can_see_conversation(contact_id, assigned_to));

drop policy if exists messages_all on public.messages;
create policy messages_all on public.messages for all to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.can_see_conversation(c.contact_id, c.assigned_to)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.can_see_conversation(c.contact_id, c.assigned_to)
    )
  );
