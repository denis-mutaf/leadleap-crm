-- Ядро: роли сотрудников, проекты застройщика и настраиваемые справочники.
-- Всё, что заказчик правит сам, живёт строками в таблицах, а не в коде.

create extension if not exists "pgcrypto";

-- Роли. Менеджер видит свои сделки, руководитель все, застройщик только сводку,
-- администратор настраивает поля и справочники.
create type user_role as enum ('manager', 'head', 'builder', 'admin');

create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null,
  role        user_role   not null default 'manager',
  -- рабочий номер менеджера в Moldcell PBX: по нему звонок привязывается к сотруднику
  work_phone  text,
  -- логин пользователя в облачной АТС, приходит в поле user вебхука
  pbx_login   text unique,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is 'Сотрудники отдела продаж. Расширяет auth.users ролью и рабочим номером.';

-- Проекты застройщика. Сделка может относиться к обоим сразу.
create table projects (
  id        uuid primary key default gen_random_uuid(),
  code      text unique not null,
  name      text        not null,
  position  smallint    not null default 0,
  is_active boolean     not null default true
);

comment on table projects is 'Select New Town и Next New Town. Воронка одна, разрез аналитики — здесь.';

-- Этапы воронки. Порядок и состав меняет администратор.
create type stage_kind as enum ('open', 'won', 'lost');

create table stages (
  id                     uuid primary key default gen_random_uuid(),
  name                   text       not null,
  position               smallint   not null,
  kind                   stage_kind not null default 'open',
  -- без заполненной квалификации сделку на этот этап не пустят
  requires_qualification boolean    not null default false,
  -- без задачи с конкретной датой сделку на этот этап не пустят
  requires_next_step     boolean    not null default true,
  is_active              boolean    not null default true,
  created_at             timestamptz not null default now()
);

create unique index stages_position_idx on stages (position) where is_active;

comment on column stages.requires_qualification is
  'Гейт квалификации: перед переходом на этот этап обязательны поля бюджета, оплаты, срока, резидентства, комнатности и цели.';
comment on column stages.requires_next_step is
  'Гейт следующего шага: перед переходом нужна открытая задача с конкретной датой. Основной затык воронки — Квалификация → Презентация.';

-- Источники обращений: разрез, в котором маркетолог считает рекламу.
create table sources (
  id        uuid primary key default gen_random_uuid(),
  code      text unique not null,
  name      text        not null,
  is_active boolean     not null default true
);

-- Причины отказа. Список закрытый, выбор обязателен при проигрыше.
create table lost_reasons (
  id        uuid primary key default gen_random_uuid(),
  name      text     not null,
  position  smallint not null default 0,
  is_active boolean  not null default true
);

-- Типы задач.
create table task_types (
  id        uuid primary key default gen_random_uuid(),
  code      text unique not null,
  name      text        not null,
  is_active boolean     not null default true
);

-- Теги. Свободного ввода нет: менеджер только выбирает из справочника,
-- заводить новые может руководитель. Через теги размечаются рефералы.
create table tags (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  color      text        not null default 'slate',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- Настройки системы одной строкой на ключ: срок SLA, часовой пояс, прочее.
create table settings (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);
