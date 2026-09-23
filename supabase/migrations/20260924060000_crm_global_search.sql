-- Глобальный поиск одной функцией (аудит 23.09.2026).
--
-- Было: клиент делал 5–6 запросов подряд; телефон искался по последним
-- четырём цифрам — «1875» находил чужой контакт с «…1875…» в другом месте
-- номера и подписывал его «Найден по номеру»; 0XX… и пробелы не находились;
-- у сделки вместо этапа показывался сырой status (open/lost).
--
-- Стало: запрос нормализуется crm_phone_digits (069… → 37369…), телефон ищется
-- по всем введённым цифрам в contact_phones и imported_contact_phones,
-- имя — по contacts.full_name. Сделки — по названию, объекту и найденным
-- контактам (основной и связанный через deal_contacts), подпись — этап.
-- Задачи — открытые, по названию и по найденным сделкам/контактам.
-- SECURITY INVOKER: видимость режет RLS, как везде.

create or replace function public.crm_global_search(p_q text, p_limit integer default 8)
returns table (kind text, id uuid, title text, meta text, deal_id uuid)
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  q       text := btrim(coalesce(p_q, ''));
  lim     integer := least(greatest(coalesce(p_limit, 8), 1), 25);
  digits  text := public.crm_phone_digits(q);
  phone   boolean := q ~ '^[0-9\s+()\-]+$' and length(regexp_replace(q, '[^0-9]', '', 'g')) >= 4;
  like_q  text;
begin
  if length(q) < 2 then return; end if;
  like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with found_contacts as materialized (
    select c.id, c.full_name
    from contacts c
    where c.deleted_at is null
      and c.merged_into is null
      and (
        (phone and (
          exists (select 1 from contact_phones cp where cp.contact_id = c.id and cp.phone like '%' || digits || '%')
          or exists (select 1 from imported_contact_phones ip where ip.contact_id = c.id and ip.normalized_phone like '%' || digits || '%')
        ))
        or (not phone and c.full_name ilike like_q)
      )
    order by c.last_activity_at desc nulls last
    limit lim
  ),
  found_deals as materialized (
    select d.id, d.title, d.object_text, d.stage_id, d.contact_id, d.updated_at
    from deals d
    where d.deleted_at is null
      and (
        (not phone and (d.title ilike like_q or d.object_text ilike like_q))
        or d.contact_id in (select fc.id from found_contacts fc)
        or exists (select 1 from deal_contacts dc where dc.deal_id = d.id and dc.contact_id in (select fc.id from found_contacts fc))
      )
    order by d.updated_at desc
    limit lim
  ),
  found_tasks as materialized (
    select t.id, t.title, t.due_at, t.deal_id
    from tasks t
    where t.done_at is null
      and t.deleted_at is null
      and (
        (not phone and t.title ilike like_q)
        or t.deal_id in (select fd.id from found_deals fd)
        or t.contact_id in (select fc.id from found_contacts fc)
      )
    order by t.due_at
    limit lim
  )
  select 'contact'::text, fc.id, coalesce(nullif(fc.full_name, ''), 'Без имени'),
    (select cp.phone from contact_phones cp where cp.contact_id = fc.id order by cp.is_primary desc, cp.created_at limit 1),
    null::uuid
  from found_contacts fc
  union all
  select 'deal'::text, fd.id, coalesce(nullif(fd.title, ''), nullif(fd.object_text, ''), 'Без названия'),
    (select s.name from stages s where s.id = fd.stage_id),
    fd.id
  from found_deals fd
  union all
  select 'task'::text, ft.id, ft.title, to_char(ft.due_at at time zone 'Europe/Chisinau', 'DD.MM.YYYY'), ft.deal_id
  from found_tasks ft;
end;
$$;

grant execute on function public.crm_global_search(text, integer) to authenticated;
