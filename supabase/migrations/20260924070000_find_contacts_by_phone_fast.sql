-- Проверка дубля телефона в «Новой сделке»: 5,9 с → миллисекунды.
--
-- Было: для каждого контакта regexp по каждому телефону (без индекса), а
-- число сделок считалось условием `contact_id = c.id OR exists(deal_contacts)`:
-- OR не даёт индекса, поэтому на каждый найденный контакт перебирались все
-- ~5,8 тыс. сделок с вызовом can_see_deal на каждую. Диалог висел «Проверяем…».
--
-- Стало: хвост из 8 цифр ищется LIKE '%хвост' — работает trigram-индекс
-- телефонов; сделки берутся только найденных контактов (прямая ссылка плюс
-- deal_contacts, через UNION), видимость — те же правила, что can_see_deal,
-- но sees_everything() считается один раз. Результат и контракт прежние.

create or replace function public.find_contacts_by_phone(p_phone text)
returns table(contact_id uuid, full_name text, latest_deal_id uuid, latest_stage text, deal_count bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  all_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  phone_tail text := right(all_digits, 8);
  actor uuid := auth.uid();
  everything boolean;
begin
  if actor is null or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(all_digits) < 8 then
    return;
  end if;
  everything := public.sees_everything();

  return query
  with phone_hits as materialized (
    select cp.contact_id from public.contact_phones cp
    where cp.phone like '%' || phone_tail
      and right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail
    union
    select ip.contact_id from public.imported_contact_phones ip
    where coalesce(ip.normalized_phone, ip.raw_phone) like '%' || phone_tail || '%'
      and right(regexp_replace(coalesce(ip.normalized_phone, ip.raw_phone), '\D', '', 'g'), 8) = phone_tail
  ),
  matched as materialized (
    select distinct coalesce(c.merged_into, c.id) as id
    from public.contacts c
    where c.id in (select h.contact_id from phone_hits h)
  ),
  visible_contacts as materialized (
    select c.id, c.full_name
    from matched m
    join public.contacts c on c.id = m.id
    where public.can_see_contact(c.id)
  ),
  links as materialized (
    select d.id as deal_id, d.contact_id as contact_id from public.deals d
    where d.contact_id in (select vc.id from visible_contacts vc)
    union
    select dc.deal_id, dc.contact_id from public.deal_contacts dc
    where dc.contact_id in (select vc.id from visible_contacts vc)
  ),
  visible_deals as materialized (
    select l.contact_id, d.id, d.created_at, s.name as stage_name
    from links l
    join public.deals d on d.id = l.deal_id
    join public.stages s on s.id = d.stage_id
    where d.deleted_at is null
      and (everything or d.owner_id = actor or d.owner_id is null)
  )
  select vc.id, vc.full_name, recent.id, recent.stage_name,
    (select count(*) from visible_deals vd where vd.contact_id = vc.id)
  from visible_contacts vc
  left join lateral (
    select vd.id, vd.stage_name, vd.created_at
    from visible_deals vd
    where vd.contact_id = vc.id
    order by vd.created_at desc, vd.id desc
    limit 1
  ) recent on true
  order by recent.created_at desc nulls last, vc.full_name, vc.id
  limit 20;
end;
$function$;
