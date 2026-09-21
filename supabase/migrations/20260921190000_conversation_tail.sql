-- Инбокс должен уметь отвечать на вопрос «кому мы не ответили» без чтения всей
-- переписки. Считать это на лету нельзя: список фильтруется и сортируется по
-- этому признаку, а сообщений уже тысячи. Хвост диалога кладётся в саму строку
-- диалога и поддерживается триггером.
alter table public.conversations
  add column if not exists last_direction public.message_direction,
  add column if not exists last_incoming_at timestamptz,
  add column if not exists last_body text,
  add column if not exists last_read_at timestamptz,
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

comment on column public.conversations.last_direction is
  'Направление последнего сообщения. in — клиент ждёт ответа.';
comment on column public.conversations.last_incoming_at is
  'Когда клиент написал в последний раз. По нему считается время ожидания и окно Meta в 24 часа.';
comment on column public.conversations.last_body is
  'Текст последнего сообщения для списка. Денормализация ради одного запроса на список.';
comment on column public.conversations.last_read_at is
  'Когда менеджер открывал диалог. Непрочитано = пришло позже этой отметки.';

create or replace function public.crm_sync_conversation_tail() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update public.conversations c
     set last_message_at = greatest(coalesce(c.last_message_at, new.sent_at), new.sent_at),
         last_direction = case when new.sent_at >= coalesce(c.last_message_at, new.sent_at)
                               then new.direction else c.last_direction end,
         last_body = case when new.sent_at >= coalesce(c.last_message_at, new.sent_at)
                          then new.body else c.last_body end,
         last_incoming_at = case when new.direction = 'in'
                                 then greatest(coalesce(c.last_incoming_at, new.sent_at), new.sent_at)
                                 else c.last_incoming_at end
   where c.id = new.conversation_id;
  return new;
end;
$fn$;

drop trigger if exists messages_sync_conversation_tail on public.messages;
create trigger messages_sync_conversation_tail
  after insert on public.messages
  for each row execute function public.crm_sync_conversation_tail();

-- Разбор уже импортированного архива: хвост считается один раз по факту.
with tail as (
  select distinct on (m.conversation_id)
         m.conversation_id, m.direction, m.body, m.sent_at
    from public.messages m
   order by m.conversation_id, m.sent_at desc, m.id desc
), incoming as (
  select conversation_id, max(sent_at) as last_incoming_at
    from public.messages where direction = 'in' group by conversation_id
)
update public.conversations c
   set last_direction = tail.direction,
       last_body = tail.body,
       last_message_at = greatest(coalesce(c.last_message_at, tail.sent_at), tail.sent_at),
       last_incoming_at = incoming.last_incoming_at
  from tail left join incoming on incoming.conversation_id = tail.conversation_id
 where c.id = tail.conversation_id;

create index if not exists conversations_unanswered_idx
  on public.conversations (last_message_at desc)
  where last_direction = 'in';
create index if not exists conversations_assigned_idx
  on public.conversations (assigned_to, last_message_at desc);
