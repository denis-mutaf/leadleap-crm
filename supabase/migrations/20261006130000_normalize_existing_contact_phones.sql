-- QA 05.10.2026, B-03/B-15: разовая чистка уже записанных телефонов (тикет 49).
-- Триггер из 20261006120000 нормализует только новые записи; здесь — старые.
--
-- 1. Номера контактов приводятся к E.164. Строка, чей нормализованный вид уже
--    занят другой строкой (contact_phones.phone уникален), не трогается и
--    попадает в NOTICE: решать, какой из двух контактов настоящий, должен человек.
-- 2. У каждого контакта остаётся не больше одного основного номера (самый
--    старый), после чего индекс не даёт завести второй.
-- Сколько строк затронуто — в сообщениях NOTICE (на момент аудита 06.10.2026
-- в боевой базе ожидается 1 строка нормализации и 1 контакт с двумя основными).

do $$
declare
  v_fixed integer;
  v_skipped integer;
  v_primary_reset integer;
begin
  select count(*) into v_skipped
  from public.contact_phones cp
  where cp.phone is distinct from public.normalize_phone(cp.phone)
    and public.normalize_phone(cp.phone) is not null
    and exists (
      select 1 from public.contact_phones o
      where o.phone = public.normalize_phone(cp.phone) and o.id <> cp.id
    );

  update public.contact_phones cp
  set phone = public.normalize_phone(cp.phone)
  where cp.phone is distinct from public.normalize_phone(cp.phone)
    and public.normalize_phone(cp.phone) is not null
    and not exists (
      select 1 from public.contact_phones o
      where o.phone = public.normalize_phone(cp.phone) and o.id <> cp.id
    );
  get diagnostics v_fixed = row_count;
  raise notice 'contact_phones: нормализовано строк %, пропущено из-за дубля %', v_fixed, v_skipped;

  update public.contact_phones cp
  set is_primary = false
  where cp.is_primary
    and cp.id <> (
      select p.id from public.contact_phones p
      where p.contact_id = cp.contact_id and p.is_primary
      order by p.created_at, p.id
      limit 1
    );
  get diagnostics v_primary_reset = row_count;
  raise notice 'contact_phones: сброшено лишних основных номеров %', v_primary_reset;
end;
$$;

create unique index if not exists contact_phones_one_primary_idx
  on public.contact_phones (contact_id)
  where is_primary;
