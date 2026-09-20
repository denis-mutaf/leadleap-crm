-- Контакты, их номера и профили в каналах; сделки и история их движения.

-- Нормализация телефона к E.164. На ней стоит вся дедупликация:
-- «+373 60 123456», «060123456» и «37360123456» — один и тот же человек.
create or replace function normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null then
    return null;
  end if;

  digits := regexp_replace(raw, '\D', '', 'g');

  if digits = '' then
    return null;
  end if;

  -- местный молдавский набор: 8 цифр, иногда с ведущим нулём
  if length(digits) = 8 then
    return '+373' || digits;
  end if;

  if length(digits) = 9 and left(digits, 1) = '0' then
    return '+373' || right(digits, 8);
  end if;

  -- международный номер как есть
  return '+' || digits;
end;
$$;

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  -- после слияния карточка остаётся, но указывает на выжившую
  merged_into   uuid references contacts (id),
  created_by    uuid references profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column contacts.merged_into is
  'Заполняется при слиянии дублей. Карточка не удаляется: история обеих сторон должна пережить объединение.';

-- Телефоны контакта. Уникальность номера и есть проверка на дубли.
create table contact_phones (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  phone      text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index contact_phones_contact_idx on contact_phones (contact_id);

-- Профили в мессенджерах: по ним входящее сообщение находит своего человека.
create type channel_kind as enum ('phone', 'whatsapp', 'viber', 'instagram', 'facebook', 'web_form', 'lead_ads', 'manual');

create table contact_channels (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts (id) on delete cascade,
  channel     channel_kind not null,
  external_id text not null,
  handle      text,
  created_at  timestamptz not null default now(),
  unique (channel, external_id)
);

-- Статус сделки существует отдельно от этапа: «отложена» может случиться на любом этапе.
create type deal_status as enum ('open', 'postponed', 'won', 'lost');
create type payment_method as enum ('cash', 'mortgage', 'installment');
create type purchase_horizon as enum ('up_to_1m', 'm1_3', 'm3_6', 'm6_12', 'over_12m');
create type residency as enum ('local', 'diaspora');
create type purchase_purpose as enum ('living', 'investment');

create table deals (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references contacts (id),
  -- пусто = общий котёл, ответственный назначается вручную
  owner_id         uuid references profiles (id),
  stage_id         uuid not null references stages (id),
  status           deal_status not null default 'open',
  title            text,

  -- интересующий объект: шахматка во внешнем софте, здесь просто текст
  object_text      text,

  source_id        uuid references sources (id),
  utm              jsonb not null default '{}'::jsonb,
  meta_campaign_id text,
  meta_lead_id     text,

  -- поля квалификации: без них не работает ни один гейт и ни один отчёт
  budget           numeric(12, 2),
  budget_currency  text not null default 'EUR',
  payment          payment_method,
  horizon          purchase_horizon,
  residency        residency,
  rooms            smallint,
  purpose          purchase_purpose,

  -- отложенная сделка: длинный цикл, обращение летом, покупка в декабре
  postponed_until  date,

  lost_reason_id   uuid references lost_reasons (id),
  lost_comment     text,

  -- SLA первого ответа
  first_inbound_at timestamptz,
  first_response_at timestamptz,
  sla_due_at       timestamptz,
  sla_breached_at  timestamptz,

  created_by       uuid references profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint deals_postponed_needs_date
    check (status <> 'postponed' or postponed_until is not null),
  constraint deals_lost_needs_reason
    check (status <> 'lost' or lost_reason_id is not null),
  constraint deals_rooms_sane
    check (rooms is null or rooms between 0 and 10)
);

comment on constraint deals_postponed_needs_date on deals is
  'Статус «отложена» без даты касания бессмыслен: в эту дату система создаёт задачу ответственному.';
comment on constraint deals_lost_needs_reason on deals is
  'Причина отказа обязательна при закрытии как проигранной, значение только из справочника.';

create index deals_owner_idx on deals (owner_id);
create index deals_stage_idx on deals (stage_id);
create index deals_contact_idx on deals (contact_id);
create index deals_status_idx on deals (status);
create index deals_created_idx on deals (created_at);

-- Проект у сделки — множественный выбор: клиенту не подошёл Select, смотрит Next
-- в той же сделке, без переноса и дубля.
create table deal_projects (
  deal_id    uuid not null references deals (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  primary key (deal_id, project_id)
);

create table deal_tags (
  deal_id    uuid not null references deals (id) on delete cascade,
  tag_id     uuid not null references tags (id) on delete cascade,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  primary key (deal_id, tag_id)
);

create table contact_tags (
  contact_id uuid not null references contacts (id) on delete cascade,
  tag_id     uuid not null references tags (id) on delete cascade,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

-- История переходов. Требование к базе, а не к интерфейсу: если хранить только
-- текущий этап, ни конверсию, ни когорты собрать нельзя и задним числом не восстановить.
create table stage_transitions (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references deals (id) on delete cascade,
  from_stage_id uuid references stages (id),
  to_stage_id   uuid not null references stages (id),
  from_status   deal_status,
  to_status     deal_status not null,
  changed_by    uuid references profiles (id),
  changed_at    timestamptz not null default now()
);

create index stage_transitions_deal_idx on stage_transitions (deal_id, changed_at);
create index stage_transitions_to_stage_idx on stage_transitions (to_stage_id, changed_at);

comment on table stage_transitions is
  'Строка на каждый переход. Никогда не перезаписывается и не удаляется: на ней стоит вся отчётность.';

-- Задачи. Дата обязательна: задача без даты не считается следующим шагом.
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references deals (id) on delete cascade,
  contact_id  uuid references contacts (id) on delete cascade,
  assignee_id uuid not null references profiles (id),
  type_id     uuid references task_types (id),
  title       text not null,
  due_at      timestamptz not null,
  remind_at   timestamptz,
  done_at     timestamptz,
  done_by     uuid references profiles (id),
  -- создана системой: пропущенный звонок, наступившая дата касания
  is_auto     boolean not null default false,
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now(),
  constraint tasks_belongs_somewhere check (deal_id is not null or contact_id is not null)
);

create index tasks_assignee_open_idx on tasks (assignee_id, due_at) where done_at is null;
create index tasks_deal_idx on tasks (deal_id) where done_at is null;

create table notes (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid references deals (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  author_id  uuid references profiles (id),
  body       text not null,
  created_at timestamptz not null default now(),
  constraint notes_belongs_somewhere check (deal_id is not null or contact_id is not null)
);

create index notes_deal_idx on notes (deal_id, created_at desc);
create index notes_contact_idx on notes (contact_id, created_at desc);
