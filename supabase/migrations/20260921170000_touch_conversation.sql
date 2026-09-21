-- Приход сообщения обновляет две вещи сразу: время последнего сообщения и
-- счётчик непрочитанных. Делать это двумя запросами из приёмника нельзя —
-- при параллельной доставке счётчик теряет инкременты.
create or replace function public.crm_touch_conversation(
  p_conversation uuid,
  p_sent_at timestamptz,
  p_incoming boolean
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at),
         unread_count = case when p_incoming then unread_count + 1 else unread_count end
   where id = p_conversation;
$$;

revoke all on function public.crm_touch_conversation(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.crm_touch_conversation(uuid, timestamptz, boolean) to service_role;
