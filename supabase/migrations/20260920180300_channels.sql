-- Каналы: сырой приёмник событий, звонки Moldcell PBX и единый инбокс переписки.
-- Каналы подключаются в разное время и разными способами, поэтому событие сперва
-- падает сырым, а разбирает его адаптер канала.

create table inbound_events (
  id           uuid primary key default gen_random_uuid(),
  channel      channel_kind not null,
  kind         text         not null,
  payload      jsonb        not null,
  -- ключ идемпотентности: оператор повторяет вебхук, дубля быть не должно
  dedup_key    text unique,
  received_at  timestamptz  not null default now(),
  processed_at timestamptz,
  error        text
);

create index inbound_events_unprocessed_idx on inbound_events (received_at) where processed_at is null;

comment on table inbound_events is
  'Сырое входящее событие любого канала до разбора. Позволяет переиграть разбор, не теряя данные оператора.';

create type call_direction as enum ('in', 'out');
-- статусы ровно как их присылает Moldcell PBX
create type call_status as enum ('success', 'missed', 'cancel', 'busy', 'not_available', 'not_allowed', 'not_found');

create table calls (
  id            uuid primary key default gen_random_uuid(),
  -- идентификатор звонка на стороне АТС
  external_id   text unique,
  direction     call_direction not null,
  status        call_status,
  from_phone    text,
  to_phone      text,
  contact_id    uuid references contacts (id),
  -- звонок привязан к контакту; если у него несколько сделок, менеджер выбирает нужную
  deal_id       uuid references deals (id),
  user_id       uuid references profiles (id),
  started_at    timestamptz not null default now(),
  answered_at   timestamptz,
  duration_sec  integer,
  -- ссылка на запись разговора, поле link в вебхуке истории
  recording_url text,
  raw           jsonb not null default '{}'::jsonb
);

create index calls_contact_idx on calls (contact_id, started_at desc);
create index calls_deal_idx on calls (deal_id, started_at desc);
create index calls_unassigned_idx on calls (started_at desc) where deal_id is null;

comment on column calls.deal_id is
  'Пусто, пока менеджер не выбрал сделку: у одного контакта их может быть несколько.';

create type message_direction as enum ('in', 'out');

create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  channel            channel_kind not null,
  external_thread_id text         not null,
  contact_id         uuid references contacts (id),
  last_message_at    timestamptz,
  unread_count       integer not null default 0,
  created_at         timestamptz not null default now(),
  unique (channel, external_thread_id)
);

create index conversations_contact_idx on conversations (contact_id, last_message_at desc);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction       message_direction not null,
  body            text,
  attachments     jsonb not null default '[]'::jsonb,
  external_id     text,
  author_user_id  uuid references profiles (id),
  sent_at         timestamptz not null default now(),
  raw             jsonb not null default '{}'::jsonb,
  unique (conversation_id, external_id)
);

create index messages_conversation_idx on messages (conversation_id, sent_at desc);
