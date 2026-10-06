-- Атрибуция обращений (QA круг 3, E3): откуда пришла сделка — форма, UTM, кампания Meta.
--
-- Схема. Идентификаторы и имена кампании / группы объявлений / объявления Meta лежат
-- колонками deals: по ним группирует отчёт «Кампании» и их же показывает карточка. Сырые
-- метки клика (utm_*, gclid, fbclid, страница отправки, имя формы) остаются в deals.utm
-- (jsonb): набор ключей у них свободный, фильтровать по ним не нужно. meta_lead_id уже
-- есть в таблице и до сих пор не заполнялся — туда пишем leadgen_id.
--
-- Что меняется:
--   1. deals: колонки meta_adset_id, meta_ad_id, meta_form_id и имена meta_*_name.
--   2. process_web_form_event: новый необязательный аргумент p_meta jsonb
--      (campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, form_id, lead_id).
--      Прежний вызов без него работает как раньше; p_meta.campaign_id важнее
--      p_meta_campaign_id. Прежняя девятиаргументная версия снимается, иначе вызов
--      с именованными аргументами стал бы неоднозначным.
--   3. crm_report_campaigns — блок «Кампании» вкладки «За период». Отдельной функцией, а не
--      правкой crm_report_period: тот отчёт трогают соседние задачи, и две миграции,
--      пересоздающие одну функцию, затирали бы друг друга.
--
-- Порядок выката: сначала эта миграция, потом код (код зовёт функцию с p_meta).

alter table public.deals
  add column if not exists meta_adset_id text,
  add column if not exists meta_ad_id text,
  add column if not exists meta_form_id text,
  add column if not exists meta_campaign_name text,
  add column if not exists meta_adset_name text,
  add column if not exists meta_ad_name text;

comment on column public.deals.meta_campaign_id is 'ID кампании Meta (campaign_id из Graph API; у импорта Amo — utm_id)';
comment on column public.deals.meta_adset_id is 'ID группы объявлений Meta (adset_id)';
comment on column public.deals.meta_ad_id is 'ID объявления Meta (ad_id)';
comment on column public.deals.meta_form_id is 'ID лид-формы Meta (form_id)';
comment on column public.deals.meta_lead_id is 'ID лида Meta (leadgen_id)';

drop function if exists public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb, jsonb, text);

create or replace function public.process_web_form_event(p_event_id uuid, p_phone text, p_name text, p_comment text, p_utm jsonb, p_meta_campaign_id text, p_unknown jsonb, p_unknown_labels jsonb, p_source_code text default 'web_form', p_meta jsonb default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  event_row public.inbound_events%rowtype;
  normalized text := public.normalize_phone(p_phone);
  phone_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  phone_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
  matched_ids uuid[];
  deleted_match_id uuid;
  target_contact_id uuid;
  target_deal_id uuid;
  stage_id uuid;
  source_id uuid;
  target_field_id uuid;
  field_key text;
  field_value jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into event_row
  from public.inbound_events
  where id = p_event_id
  for update;
  if not found then
    raise exception 'Inbound event not found' using errcode = '22023';
  end if;

  if event_row.processed_at is not null then
    select d.id into target_deal_id
    from public.deals d
    where d.intake_event_id = p_event_id and d.deleted_at is null;
    if target_deal_id is null then
      select n.deal_id into target_deal_id
      from public.notes n
      where n.intake_event_id = p_event_id and n.deleted_at is null;
    end if;
    if target_deal_id is null then
      -- Stable duplicate acknowledgement even when the original deal is trashed.
      select d.id into target_deal_id
      from public.deals d
      where d.intake_event_id = p_event_id;
    end if;
    return jsonb_build_object('deal_id', target_deal_id, 'duplicate', true);
  end if;

  if normalized is null or length(phone_digits) < 8 or length(phone_digits) > 15 then
    raise exception 'Некорректный номер телефона' using errcode = '22023';
  end if;

  select c.id into deleted_match_id
  from public.contacts c
  where c.deleted_at is not null
    and (exists (
      select 1 from public.contact_phones cp
      where cp.contact_id = c.id
        and (cp.phone = normalized or right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail)
    ) or exists (
      select 1 from public.imported_contact_phones ip
      where ip.contact_id = c.id and ip.normalized_phone is not null
        and (ip.normalized_phone = normalized
          or right(regexp_replace(ip.normalized_phone, '\D', '', 'g'), 8) = phone_tail)
    ))
  limit 1;
  if deleted_match_id is not null then
    raise exception 'Phone resolves to deleted contact' using errcode = '55006';
  end if;

  select array_agg(distinct coalesce(c.merged_into, c.id)) into matched_ids
  from public.contacts c
  where c.deleted_at is null
    and (exists (
      select 1 from public.contact_phones cp
      where cp.contact_id = c.id
        and (cp.phone = normalized or right(regexp_replace(cp.phone, '\D', '', 'g'), 8) = phone_tail)
    ) or exists (
      select 1 from public.imported_contact_phones ip
      where ip.contact_id = c.id and ip.normalized_phone is not null
        and (ip.normalized_phone = normalized
          or right(regexp_replace(ip.normalized_phone, '\D', '', 'g'), 8) = phone_tail)
    ));

  if coalesce(cardinality(matched_ids), 0) > 1 then
    raise exception 'Ambiguous phone match: % contacts', cardinality(matched_ids) using errcode = '21000';
  end if;
  target_contact_id := matched_ids[1];

  if target_contact_id is not null and exists (
    select 1 from public.contacts c where c.id = target_contact_id and c.deleted_at is not null
  ) then
    raise exception 'Phone resolves to deleted contact' using errcode = '55006';
  end if;

  if target_contact_id is null then
    insert into public.contacts (full_name)
    values (coalesce(nullif(btrim(p_name), ''), 'Без имени'))
    returning id into target_contact_id;
    insert into public.contact_phones (contact_id, phone, is_primary)
    values (target_contact_id, normalized, true);
  end if;

  select d.id into target_deal_id
  from public.deals d
  where d.deleted_at is null
    and d.status not in ('won', 'lost')
    and (d.contact_id = target_contact_id or exists (
      select 1 from public.deal_contacts dc
      where dc.deal_id = d.id and dc.contact_id = target_contact_id
    ))
  order by d.created_at desc
  limit 1
  for update;

  if target_deal_id is null then
    select s.id into stage_id from public.stages s
    where s.is_active and s.kind = 'open' order by s.position limit 1;
    if stage_id is null then raise exception 'No active open stage'; end if;
    select s.id into source_id from public.sources s
    where s.code = coalesce(p_source_code, 'web_form') and s.is_active limit 1;
    if source_id is null then
      raise exception 'Нет активного источника %', coalesce(p_source_code, 'web_form');
    end if;

    insert into public.deals (
      contact_id, stage_id, source_id, title, utm, meta_campaign_id,
      meta_campaign_name, meta_adset_id, meta_adset_name, meta_ad_id, meta_ad_name,
      meta_form_id, meta_lead_id, first_inbound_at, intake_event_id
    ) values (
      target_contact_id, stage_id, source_id,
      case when nullif(btrim(p_name), '') is not null then 'Форма сайта: ' || btrim(p_name) else 'Форма сайта' end,
      coalesce(p_utm, '{}'::jsonb), coalesce(nullif(p_meta ->> 'campaign_id', ''), p_meta_campaign_id),
      nullif(p_meta ->> 'campaign_name', ''), nullif(p_meta ->> 'adset_id', ''),
      nullif(p_meta ->> 'adset_name', ''), nullif(p_meta ->> 'ad_id', ''),
      nullif(p_meta ->> 'ad_name', ''), nullif(p_meta ->> 'form_id', ''),
      nullif(p_meta ->> 'lead_id', ''), now(), p_event_id
    ) returning id into target_deal_id;
  else
    insert into public.notes (deal_id, body, intake_event_id)
    values (target_deal_id, coalesce(nullif(p_comment, ''), 'Обращение с формы сайта (повторное обращение)'), p_event_id);
  end if;

  insert into public.deal_contacts (deal_id, contact_id, is_primary)
  select d.id, target_contact_id, d.contact_id = target_contact_id
  from public.deals d
  where d.id = target_deal_id and d.deleted_at is null
  on conflict (deal_id, contact_id) do nothing;

  if p_comment is not null and btrim(p_comment) <> ''
     and not exists (select 1 from public.notes n where n.intake_event_id = p_event_id) then
    insert into public.notes (deal_id, body, intake_event_id)
    values (target_deal_id, p_comment, p_event_id);
  end if;

  for field_key, field_value in select key, value from jsonb_each(coalesce(p_unknown, '{}'::jsonb)) loop
    select d.id into target_field_id from public.custom_field_defs d
    where d.entity = 'deal' and d.key = field_key;
    if target_field_id is null then
      insert into public.custom_field_defs (entity, key, label, field_type, auto_created)
      values ('deal', field_key, coalesce(nullif(p_unknown_labels ->> field_key, ''), field_key), 'text', true)
      on conflict (entity, key) do update set key = excluded.key
      returning id into target_field_id;
      if target_field_id is null then
        select d.id into target_field_id from public.custom_field_defs d
        where d.entity = 'deal' and d.key = field_key;
      end if;
    end if;
    insert into public.custom_field_values (field_id, entity_id, value)
    values (target_field_id, target_deal_id, field_value)
    on conflict (field_id, entity_id) do update set value = excluded.value;
  end loop;

  update public.inbound_events
  set processed_at = now(), error = null
  where id = p_event_id;
  return jsonb_build_object('deal_id', target_deal_id, 'duplicate', false);
end;
$function$;

revoke all on function public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_web_form_event(uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) to service_role;

-- Отчёт «Кампании»: те же фильтры и правила периода, что у crm_report_period
-- (календарные дни Europe/Chisinau, обе границы включительно; null — без фильтра,
-- 'none' — «не указан»). security invoker: права и строки решает RLS вызывающего.
--
-- Две разбивки одних и тех же сделок:
--   utm  — по utm_campaign (у импорта Amo то же значение лежит под ключом campaign);
--          регистр и крайние пробелы не различаются;
--   meta — по ID кампании Meta; имя берётся любое найденное у сделок группы.
-- Сделки без кампании собраны в строку с ключом 'none'.
--
-- Столбцы считаются как в «Источниках»: обращений — созданные в периоде; КВАЛ — из них
-- с меткой «КВАЛ» сейчас; встреч — вошли в этап «встреча проведена» в периоде; резерваций —
-- вошли в «Резервацию» в периоде; conv — созданные в периоде и вошедшие в «Резервацию»
-- в нём же (конверсия = conv / обращений).
create or replace function public.crm_report_campaigns(
  p_from date,
  p_to date,
  p_source text default null,
  p_manager text default null,
  p_project text default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
-- Как в crm_report_period: без вложенных циклов время не растёт с шириной периода.
set enable_nestloop = off
as $$
with
w as (
  select
    (p_from::timestamp at time zone 'Europe/Chisinau') as t0,
    ((p_to + 1)::timestamp at time zone 'Europe/Chisinau') as t1
),
stg as materialized (
  select s.id,
         (s.import_key in ('amo:stage:60', 'amo:stage:70')) as is_meeting,
         (s.import_key = 'amo:stage:90') as is_reserve
  from public.stages s
  where s.kind in ('open', 'won')
    and s.import_key in ('amo:stage:60', 'amo:stage:70', 'amo:stage:90')
),
dp as materialized (
  select x.deal_id, array_agg(x.project_id) as ids
  from public.deal_projects x
  group by x.deal_id
),
dl as materialized (
  select d.id, d.created_at,
         nullif(lower(btrim(coalesce(nullif(d.utm ->> 'utm_campaign', ''), d.utm ->> 'campaign'))), '') as ukey,
         nullif(btrim(coalesce(nullif(d.utm ->> 'utm_campaign', ''), d.utm ->> 'campaign')), '') as uname,
         nullif(btrim(d.meta_campaign_id), '') as mkey,
         nullif(btrim(d.meta_campaign_name), '') as mname
  from public.deals d
  left join dp on dp.deal_id = d.id
  where (select auth.uid()) is not null
    and (select public.my_role()) in ('manager', 'head', 'admin')
    and d.deleted_at is null
    and (p_source is null
         or (p_source = 'none' and d.source_id is null)
         or d.source_id::text = p_source)
    and (p_manager is null
         or (p_manager = 'none' and d.owner_id is null)
         or d.owner_id::text = p_manager)
    and (p_project is null
         or (p_project = 'none' and dp.deal_id is null)
         or p_project = any (dp.ids::text[]))
),
-- вход в этапы «встреча» / «резервация» в окне; переход «этап → тот же этап» — шум импорта
tr as materialized (
  select st.deal_id, bool_or(s.is_meeting) as met, bool_or(s.is_reserve) as resv
  from public.stage_transitions st
  join stg s on s.id = st.to_stage_id
  cross join w
  where st.from_stage_id is distinct from st.to_stage_id
    and st.changed_at >= w.t0 and st.changed_at < w.t1
  group by st.deal_id
),
kv as materialized (
  select distinct dt.deal_id
  from public.deal_tags dt
  join public.tags t on t.id = dt.tag_id
  where t.name = 'КВАЛ'
),
dm as materialized (
  select d.ukey, d.uname, d.mkey, d.mname,
         (d.created_at >= w.t0 and d.created_at < w.t1) as created,
         (kv.deal_id is not null) as kval,
         coalesce(tr.met, false) as met,
         coalesce(tr.resv, false) as resv
  from dl d
  cross join w
  left join tr on tr.deal_id = d.id
  left join kv on kv.deal_id = d.id
  where (d.created_at >= w.t0 and d.created_at < w.t1) or tr.deal_id is not null
),
segv as (
  select 'utm'::text as dim, coalesce(ukey, 'none') as k, uname as nm, created, kval, met, resv from dm
  union all
  select 'meta', coalesce(mkey, 'none'), mname, created, kval, met, resv from dm
),
seg as materialized (
  select dim, k, min(nm) as nm,
         count(*) filter (where created) as obr,
         count(*) filter (where created and kval) as kval,
         count(*) filter (where met) as met,
         count(*) filter (where resv) as resv,
         count(*) filter (where created and resv) as conv
  from segv
  group by dim, k
)
select jsonb_build_object(
  'generated_at', now(),
  'utm', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', g.k, 'name', g.nm, 'obr', g.obr, 'kval', g.kval,
      'met', g.met, 'resv', g.resv, 'conv', g.conv
    ) order by g.obr desc, g.resv desc, g.k), '[]'::jsonb)
    from (select * from seg where dim = 'utm' order by obr desc, resv desc, k limit 200) g
  ),
  'meta', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', g.k, 'name', g.nm, 'obr', g.obr, 'kval', g.kval,
      'met', g.met, 'resv', g.resv, 'conv', g.conv
    ) order by g.obr desc, g.resv desc, g.k), '[]'::jsonb)
    from (select * from seg where dim = 'meta' order by obr desc, resv desc, k limit 200) g
  )
);
$$;

revoke all on function public.crm_report_campaigns(date, date, text, text, text) from public;
revoke all on function public.crm_report_campaigns(date, date, text, text, text) from anon;
grant execute on function public.crm_report_campaigns(date, date, text, text, text) to authenticated;
