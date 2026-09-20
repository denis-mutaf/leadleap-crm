-- Уведомления в окне CRM и лог изменений.

create type notification_kind as enum (
  'incoming_call',      -- звонок от известного контакта, показать до поднятия трубки
  'new_lead',           -- новое обращение
  'new_message',        -- сообщение в любом канале переписки
  'sla_breach',         -- просрочен первый ответ
  'task_overdue',       -- просрочена задача
  'postponed_due'       -- наступила дата касания по отложенной сделке
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       notification_kind not null,
  title      text not null,
  body       text,
  deal_id    uuid references deals (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  call_id    uuid references calls (id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- Непрочитанные собираются в список, чтобы ни одно не потерялось,
-- пока менеджер был вне системы.
create index notifications_unread_idx on notifications (user_id, created_at desc) where read_at is null;

-- Набор событий и адресаты настраиваются администратором.
create table notification_rules (
  id         uuid primary key default gen_random_uuid(),
  kind       notification_kind not null,
  -- кому: владельцу сделки, роли целиком или обоим
  notify_owner boolean not null default true,
  notify_role  user_role,
  in_app     boolean not null default true,
  email      boolean not null default false,
  is_active  boolean not null default true,
  unique (kind, notify_role)
);

-- Лог изменений: кто и когда менял этап, удалял лид, переназначал ответственного,
-- менял значения полей.
create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  entity     text not null,
  entity_id  uuid not null,
  action     text not null,
  changes    jsonb not null default '{}'::jsonb,
  actor_id   uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity, entity_id, created_at desc);
create index audit_log_actor_idx on audit_log (actor_id, created_at desc);
