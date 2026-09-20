-- Пользовательские поля: администратор заводит их сам, без разработчика.
-- Сюда же автоматически попадают новые поля формы сайта — форма не должна
-- ждать релиза, чтобы её новое поле доехало до карточки.

create type custom_entity as enum ('deal', 'contact');
create type custom_field_type as enum ('text', 'number', 'date', 'select', 'checkbox');

create table custom_field_defs (
  id          uuid primary key default gen_random_uuid(),
  entity      custom_entity     not null,
  key         text              not null,
  label       text              not null,
  field_type  custom_field_type not null default 'text',
  -- варианты для типа «список»
  options     jsonb             not null default '[]'::jsonb,
  position    smallint          not null default 0,
  is_required boolean           not null default false,
  is_active   boolean           not null default true,
  -- поле появилось само из входящей формы, администратор его ещё не трогал
  auto_created boolean          not null default false,
  created_by  uuid references profiles (id),
  created_at  timestamptz       not null default now(),
  unique (entity, key)
);

comment on column custom_field_defs.auto_created is
  'Поле заведено приёмником формы сайта: в форму добавили вопрос, CRM подхватила его без разработчика.';

create table custom_field_values (
  id        uuid primary key default gen_random_uuid(),
  field_id  uuid not null references custom_field_defs (id) on delete cascade,
  entity_id uuid not null,
  value     jsonb,
  unique (field_id, entity_id)
);

create index custom_field_values_entity_idx on custom_field_values (entity_id);
