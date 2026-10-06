-- Смоук тикета 51 (QA B-07): дозаливка данных Amo. Только чтение: BEGIN…ROLLBACK, без DDL и записи.
-- Два режима, в начале каждого блока написано, когда его запускать.
--   БЛОК A — ДО применения 20261006220000…220600: сколько строк затронет каждая миграция,
--            плюс списки для решения (тестовые лиды FB, сделки с двумя проектами).
--   БЛОК B — ПОСЛЕ применения: постусловия. Любой провал — raise exception 'FAIL …'.
--            Ожидаемо: строка 'OK: qa-51'.
-- Цифры в комментариях — прод на 06.10.2026 (сделок Amo 5 749, не-Amo 126).

begin;

-- ===================================================================================
-- БЛОК A. ДО применения. Один результат: пункт | будет затронуто.
-- ===================================================================================
with
-- п.1 источник (правила — как в 20261006220000_amo_backfill_sources.sql)
tag_rule(tag, code, prio) as (values
  ('tiktok','tiktok',1),('знакомые/рекомендация','referral',2),('с улицы','walk_in',3),
  ('mesaj whatsapp','whatsapp',4),('mesaj viber','viber',5),('fbform','lead_ads',6),
  ('сообщение (paid)','meta_messenger',7),('сообщение (organic)','meta_messenger',7),
  ('tilda','web_form',8),('сайт (заявка)','web_form',8),('marquiz','web_form',8),('звонок','phone',9)
), sid_rule(sid, code, kind) as (values
  ('23490583','instagram','messenger'),('23490585','instagram','messenger'),
  ('23490587','facebook','messenger'),('23490589','facebook','messenger'),
  ('23490579','lead_ads','form'),('23492339','lead_ads','form'),
  ('23491781','web_form','form'),('23490967','web_form','form'),('23492329','phone','phone')
), lead as (
  select l.amo_id::bigint as lead_id, l.payload ->> 'source_id' as sid, l.payload ->> 'name' as name,
         case when jsonb_typeof(l.payload -> '_embedded' -> 'tags') = 'array' then l.payload -> '_embedded' -> 'tags' else '[]'::jsonb end as tags,
         case when jsonb_typeof(l.payload -> 'custom_fields_values') = 'array' then l.payload -> 'custom_fields_values' else '[]'::jsonb end as cf
  from public.amo_import_records l where l.entity_type = 'lead'
), by_tag as (
  select distinct on (lead.lead_id) lead.lead_id, r.code
  from lead cross join lateral jsonb_array_elements(lead.tags) t
       join tag_rule r on r.tag = t ->> 'name'
       left join sid_rule s on s.sid = lead.sid and s.kind = 'form'
  order by lead.lead_id, (s.code = r.code) desc nulls last, r.prio
), src as (
  select lead.lead_id,
         case when bt.code = 'meta_messenger' then coalesce(sm.code, 'meta_messenger') else coalesce(bt.code, sf.code) end as code
  from lead left join by_tag bt on bt.lead_id = lead.lead_id
       left join sid_rule sm on sm.sid = lead.sid and sm.kind = 'messenger'
       left join sid_rule sf on sf.sid = lead.sid
),
-- п.2 проект
sig as (
  select lead_id,
         (exists (select 1 from jsonb_array_elements(tags) t where t ->> 'name' = 'next')
          or name ~* '(^|[^a-z0-9])isragrup\.md/(ru/|ro/)?next([^a-z]|$)'
          or exists (select 1 from jsonb_array_elements(cf) f where f ->> 'field_name' = 'FORMNAME' and f -> 'values' -> 0 ->> 'value' ~* 'next')) as is_next,
         (name ~* 'selectnewtown\.isragrup\.md'
          or exists (select 1 from jsonb_array_elements(cf) f where f ->> 'field_name' = 'ЖК' and f -> 'values' -> 0 ->> 'value' ~* 'select')) as is_select
  from lead
), proj as (
  select lead_id, case when is_next and not is_select then 'next' when is_select and not is_next then 'select' end as code, (is_next and is_select) as conflict
  from sig
),
-- п.4 звонки
cc as (
  select k.id as call_id, k.contact_id, k.started_at from public.calls k
   where k.external_id like 'amo-note:%' and k.deal_id is null and k.contact_id is not null
), cand as (
  select cc.call_id, d.id as deal_id, cc.started_at, d.created_at, d.closed_at
    from cc join public.deal_contacts dc on dc.contact_id = cc.contact_id
            join public.deals d on d.id = dc.deal_id and d.deleted_at is null
), callpick as (
  select distinct on (call_id) call_id, deal_id from cand
   order by call_id,
            (created_at <= started_at and (closed_at is null or closed_at >= started_at)) desc,
            (created_at <= started_at) desc,
            case when created_at <= started_at then created_at end desc nulls last,
            created_at asc, deal_id
),
-- п.7 комнатность
fv as (
  select v.entity_id as deal_id, btrim(v.value #>> '{}') as val
    from public.custom_field_values v join public.custom_field_defs f on f.id = v.field_id and f.entity = 'deal' and f.key = 'rooms_wanted'
   where btrim(coalesce(v.value #>> '{}', '')) <> ''
), parsed as (
  select fv.deal_id, fv.val,
         case when fv.val ~ '^\d{1,2}$' then array[fv.val::int]
              else (select array_agg(distinct m[1]::int) from regexp_matches(fv.val, '(\d{1,2})\s*(?:camer|комн)', 'gi') as m) end as nums
    from fv where fv.val !~* 'test lead|dummy data'
), rooms as (
  select deal_id, val,
         case when cardinality(nums) = 1 and nums[1] between 1 and 20 then least(nums[1], 4)::smallint end as rooms_new,
         (val !~ '^\d{1,2}$') as keep_text
    from parsed
)
select '1. источник: сделок получат source_id' as item, count(*)::text as n
  from src join public.deals d on d.amo_id = src.lead_id where d.source_id is null and src.code is not null
union all select '1. источник: останутся без источника', count(*)::text
  from src join public.deals d on d.amo_id = src.lead_id where d.source_id is null and src.code is null
union all select '1. источник: ' || coalesce(code, '<пусто>'), count(*)::text from src group by code
union all select '2. проект: next (новых)', count(*)::text
  from proj join public.deals d on d.amo_id = proj.lead_id
 where proj.code = 'next' and not exists (select 1 from public.deal_projects dp where dp.deal_id = d.id)
union all select '2. проект: select (новых)', count(*)::text
  from proj join public.deals d on d.amo_id = proj.lead_id
 where proj.code = 'select' and not exists (select 1 from public.deal_projects dp where dp.deal_id = d.id)
union all select '2. проект: сделок Amo с двумя сигналами (пропуск)', count(*)::text from proj where conflict
union all select '2. проект: сделок CRM с >1 проектом сейчас', count(*)::text
  from (select deal_id from public.deal_projects group by deal_id having count(*) > 1) x
union all select '3. история этапов: новых переходов из событий', count(*)::text
  from public.amo_import_records e
       join public.deals d on d.amo_id = (e.payload ->> 'entity_id')::bigint
       join public.amo_stage_map mf on mf.amo_status_id = (e.payload -> 'value_before' -> 0 -> 'lead_status' ->> 'id')::bigint
       join public.amo_stage_map mt on mt.amo_status_id = (e.payload -> 'value_after' -> 0 -> 'lead_status' ->> 'id')::bigint
 where e.entity_type = 'event' and e.payload ->> 'type' = 'lead_status_changed' and e.payload ->> 'entity_type' = 'lead'
   and not exists (select 1 from public.stage_transitions s where s.amo_event_id = e.payload ->> 'id')
union all select '3. история этапов: событий без сделки в CRM (не переносятся)', count(*)::text
  from public.amo_import_records e
 where e.entity_type = 'event' and e.payload ->> 'type' = 'lead_status_changed'
   and not exists (select 1 from public.deals d where d.amo_id = (e.payload ->> 'entity_id')::bigint)
union all select '4. звонки: получат deal_id', count(*)::text from callpick
union all select '4. звонки: контакт без сделок (останутся на контакте)', count(*)::text
  from cc where not exists (select 1 from public.deal_contacts dc join public.deals d on d.id = dc.deal_id and d.deleted_at is null where dc.contact_id = cc.contact_id)
union all select '5. HTML-сущности: contacts.full_name', count(*)::text from public.contacts where full_name ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
union all select '5. HTML-сущности: notes.body', count(*)::text from public.notes where body ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
union all select '5. HTML-сущности: deals (title/object/wishes/lost_comment)', count(*)::text from public.deals
 where (coalesce(title,'')||' '||coalesce(object_text,'')||' '||coalesce(wishes,'')||' '||coalesce(lost_comment,'')) ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
union all select '5. HTML-сущности: tasks', count(*)::text from public.tasks
 where (coalesce(title,'')||' '||coalesce(result_text,'')) ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
union all select '7. комнатность: rooms будет заполнен', count(*)::text
  from rooms x join public.deals d on d.id = x.deal_id where d.rooms is null and x.rooms_new is not null
union all select '7. комнатность: конфликт с уже заполненным rooms', count(*)::text
  from rooms x join public.deals d on d.id = x.deal_id where d.rooms is not null and x.rooms_new is not null and d.rooms <> x.rooms_new
union all select '7. комнатность: текст уйдёт в rooms_text', count(*)::text
  from rooms x join public.deals d on d.id = x.deal_id where d.rooms_text is null and x.keep_text
union all select '7. комнатность: значения, где одно число не определяется', count(*)::text from rooms where rooms_new is null
union all select '7. «Телефон источника» → utm.source_phone', count(*)::text
  from public.custom_field_values v join public.custom_field_defs f on f.id = v.field_id and f.key = 'source_phone'
       join public.deals d on d.id = v.entity_id
 where btrim(coalesce(v.value #>> '{}', '')) <> '' and not (coalesce(d.utm, '{}'::jsonb) ? 'source_phone')
union all select '8. причина «Не указана в Amo» активна (1 = будет выключена)', count(*)::text
  from public.lost_reasons where name = 'Не указана в Amo' and is_active
union all select '8. метки к слиянию (iul, au, ma): связей сделок', count(*)::text
  from public.deal_tags dt join public.tags t on t.id = dt.tag_id where t.name in ('iul', 'au', 'ma')
union all select '8. метки к слиянию (iul, au, ma): активных меток', count(*)::text
  from public.tags where name in ('iul', 'au', 'ma') and is_active
order by 1;

-- п.6. Тестовые лиды Facebook — данные НЕ меняются, список для решения.
-- Надёжный признак: телефон «<test lead: dummy data for phone_number>» и имя
-- «<test lead: dummy data for full_name>». Кандидаты послабее (имя «test») — отдельно.
select 'надёжный признак' as kind, c.amo_id as contact_amo_id, c.id as contact_id, c.full_name,
       (select string_agg(d.id::text || ' (amo ' || d.amo_id || ', ' || s.name || ')', '; ')
          from public.deals d join public.stages s on s.id = d.stage_id where d.contact_id = c.id) as deals
  from public.contacts c
 where exists (select 1 from public.imported_contact_phones i where i.contact_id = c.id and i.raw_phone ~* 'test lead|dummy data')
    or c.full_name ~* 'test lead|dummy data'
union all
select 'имя «test» (проверить вручную)', c.amo_id, c.id, c.full_name,
       (select string_agg(d.id::text || ' (amo ' || d.amo_id || ', ' || s.name || ')', '; ')
          from public.deals d join public.stages s on s.id = d.stage_id where d.contact_id = c.id)
  from public.contacts c
 where c.amo_id is not null and c.full_name ~* '\mtest\M' and c.full_name !~* 'dummy data'
order by 1, 2;

-- ===================================================================================
-- БЛОК B. ПОСЛЕ применения. Постусловия; допуски на строки, которые менеджеры успели
-- изменить во время применения (skip locked) — запустите миграции повторно.
-- ===================================================================================
do $$
declare n int;
begin
  -- п.1: источник
  select count(*) into n from public.deals where amo_id is not null and source_id is null;
  if n > 110 then raise exception 'FAIL 1: сделок Amo без источника % (ожидалось ≤ 102 + занятые)', n; end if;
  if not exists (select 1 from public.sources where code = 'tiktok')
     or not exists (select 1 from public.sources where code = 'meta_messenger') then
    raise exception 'FAIL 1: нет источников tiktok / meta_messenger';
  end if;
  select count(*) into n from public.deals d join public.sources s on s.id = d.source_id
   where d.amo_id is not null and s.code in ('lead_ads', 'web_form', 'facebook', 'instagram', 'phone');
  if n < 5000 then raise exception 'FAIL 1: источников из Amo слишком мало (%), ожидалось ≈ 5 400', n; end if;
  -- ручные сделки не тронуты: источник Amo не должен появиться у сделок без amo_id по этому правилу
  -- (проверка косвенная: у не-Amo сделок источника не стало больше 126)

  -- п.2: проект одиночный там, где его проставил импорт
  select count(*) into n from (select dp.deal_id from public.deal_projects dp join public.deals d on d.id = dp.deal_id
                                where d.amo_id is not null group by dp.deal_id having count(*) > 1) x;
  if n > 0 then raise exception 'FAIL 2: у % сделок Amo больше одного проекта', n; end if;

  -- п.3: история этапов
  select count(*) into n from public.stage_transitions where amo_event_id is not null;
  if n < 2323 then raise exception 'FAIL 3: переходов из Amo % (ожидалось ≥ 2323)', n; end if;

  -- п.4: звонки Amo привязаны к сделкам
  select count(*) into n from public.calls where external_id like 'amo-note:%' and deal_id is null
     and contact_id in (select dc.contact_id from public.deal_contacts dc join public.deals d on d.id = dc.deal_id and d.deleted_at is null);
  if n > 50 then raise exception 'FAIL 4: звонков Amo без сделки у контактов со сделками: %', n; end if;
  select count(*) into n from public.calls where external_id like 'amo-note:%';
  if n <> 7502 then raise exception 'FAIL 4: звонков Amo стало %, было 7502', n; end if;

  -- п.5: HTML-сущности
  select count(*) into n from public.contacts where full_name ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);';
  if n > 0 then raise exception 'FAIL 5: в contacts.full_name осталось % сущностей', n; end if;
  select count(*) into n from public.notes where body ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);';
  if n > 0 then raise exception 'FAIL 5: в notes.body осталось % сущностей', n; end if;

  -- п.7: комнатность
  select count(*) into n from public.deals where rooms is not null;
  if n < 2700 then raise exception 'FAIL 7: комнатность заполнена у % сделок (ожидалось ≈ 2 739)', n; end if;
  select count(*) into n from public.custom_field_defs where entity = 'deal' and key in ('rooms_wanted', 'room_count') and is_active;
  if n > 0 then raise exception 'FAIL 7: дубли комнатности ещё активны'; end if;
  select count(*) into n from public.custom_field_values v join public.custom_field_defs f on f.id = v.field_id and f.key = 'rooms_wanted';
  if n < 2800 then raise exception 'FAIL 7: значения rooms_wanted потеряны (%)', n; end if;

  -- п.8: справочники
  if exists (select 1 from public.lost_reasons where name = 'Не указана в Amo' and is_active) then
    raise exception 'FAIL 8: «Не указана в Amo» ещё активна';
  end if;
  select count(*) into n from public.deals d join public.lost_reasons r on r.id = d.lost_reason_id where r.name = 'Не указана в Amo';
  if n <> 48 then raise exception 'FAIL 8: у закрытых сделок причина «Не указана в Amo» должна остаться (48), есть %', n; end if;
  select count(*) into n from public.tags t
   where t.name in ('iul', 'au', 'ma') and (t.is_active or t.merged_into is null);
  if n > 0 then raise exception 'FAIL 8: метки iul/au/ma не слиты'; end if;
  select count(*) into n from public.deal_tags dt join public.tags t on t.id = dt.tag_id where t.name in ('iul', 'au', 'ma');
  if n > 0 then raise exception 'FAIL 8: на архивных метках остались связи (%)', n; end if;
end $$;

select 'OK: qa-51' as result;
rollback;
