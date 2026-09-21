-- Поиск по контактам шёл последовательным просмотром: ilike '%…%' не берёт
-- обычный btree. Триграммные индексы делают поиск по имени и телефону
-- индексным.
create extension if not exists pg_trgm;

create index if not exists contacts_full_name_trgm_idx
  on public.contacts using gin (full_name gin_trgm_ops);

create index if not exists contact_phones_phone_trgm_idx
  on public.contact_phones using gin (phone gin_trgm_ops);
