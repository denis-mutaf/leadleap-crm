-- Поля заказчика из Amo доезжают до карточки.
--
-- Импорт сохранил сырой ответ Amo в deals.amo_custom_fields на всех сделках,
-- но в интерфейсе видно два поля из шестнадцати: остальные никуда не разложены.
-- Здесь они раскладываются в штатный механизм пользовательских полей
-- (custom_field_defs / custom_field_values), а рекламная атрибуция — в deals.utm.
--
-- Миграция идемпотентна: повторный прогон обновляет значения, а не плодит их.

-- 1. Справочник полей. Порядок — по частоте заполнения в живой базе.
insert into public.custom_field_defs (entity, key, label, field_type, options, position)
values
  ('deal', 'rooms_wanted',  'Сколько комнат интересует', 'text',   '[]'::jsonb,  10),
  ('deal', 'search_stage',  'На каком этапе поиска',     'text',   '[]'::jsonb,  20),
  ('deal', 'payment_method','Способ оплаты',             'select',
     '["Полная","Рассрочка","Ипотека"]'::jsonb, 30),
  ('deal', 'source_phone',  'Телефон источника',         'text',   '[]'::jsonb,  40),
  ('deal', 'complex',       'ЖК',                        'select',
     '["Select New Town","New Town","Casa Verde"]'::jsonb, 50),
  ('deal', 'block',         'Блок',                      'text',   '[]'::jsonb,  60),
  ('deal', 'entrance',      'Подъезд',                   'text',   '[]'::jsonb,  70),
  ('deal', 'floor',         'Этаж',                      'number', '[]'::jsonb,  80),
  ('deal', 'apartment_no',  '№ квартиры',                'text',   '[]'::jsonb,  90),
  ('deal', 'area_m2',       'Площадь, м²',               'number', '[]'::jsonb, 100),
  ('deal', 'price_per_m2',  'Цена за м², €',             'number', '[]'::jsonb, 110),
  ('deal', 'room_count',    'Количество комнат',         'number', '[]'::jsonb, 120),
  ('deal', 'premise_id',    'ID помещения',              'number', '[]'::jsonb, 130)
on conflict (entity, key) do update
  set label      = excluded.label,
      field_type = excluded.field_type,
      options    = excluded.options,
      position   = excluded.position;

-- 2-3. Значения. Какое поле Amo во что превращается: вопрос «сколько комнат»
--      задавался в двух формах, русской и румынской, значит это одно поле,
--      а не два. На сделку и ключ берём первое непустое значение по приоритету.
with amo_field_map (amo_name, key, ord) as (
  values
    ('Хочу кол-во комнат',                       'rooms_wanted',   1),
    ('CU_CÂTE_CAMERE_VĂ_INTERESEAZĂ_APARTAMENT', 'rooms_wanted',   2),
    ('LA_CE_ETAPĂ_VĂ_AFLAȚI_ACUM',               'search_stage',   1),
    ('LA_CE_ETAPĂ_VĂ_AFLAȚI_ACUM_ÎNTREBARE_IMPORTANTĂ_PENTRU_FORMAREA_OFERTEI',
                                                 'search_stage',   2),
    ('Способ оплаты',                            'payment_method', 1),
    ('Source phone',                             'source_phone',   1),
    ('ЖК',                                       'complex',        1),
    ('Блок',                                     'block',          1),
    ('Подъезд',                                  'entrance',       1),
    ('Этаж',                                     'floor',          1),
    ('№ квартиры',                               'apartment_no',   1),
    ('Площадь, м2',                              'area_m2',        1),
    ('Цена за м2, €',                            'price_per_m2',   1),
    ('Количество комнат',                        'room_count',     1),
    ('ID Помещения',                             'premise_id',     1)
),
flat as (
  select
    d.id as deal_id,
    m.key,
    m.ord,
    btrim(v.value ->> 'value') as text_value
  from public.deals d
       cross join lateral jsonb_array_elements(coalesce(d.amo_custom_fields, '[]'::jsonb)) f
       join amo_field_map m on m.amo_name = f ->> 'field_name'
       cross join lateral jsonb_array_elements(coalesce(f -> 'values', '[]'::jsonb)) v
  where d.amo_custom_fields is not null
    and btrim(coalesce(v.value ->> 'value', '')) <> ''
),
picked as (
  select distinct on (deal_id, key) deal_id, key, text_value
  from flat
  order by deal_id, key, ord
)
insert into public.custom_field_values (field_id, entity_id, value)
select defs.id, picked.deal_id, to_jsonb(picked.text_value)
from picked
     join public.custom_field_defs defs
       on defs.entity = 'deal' and defs.key = picked.key
on conflict (field_id, entity_id) do update set value = excluded.value;

-- 4. Атрибуция. Маркетологу нужен разрез по кампании, а не сырой блоб.
with attribution as (
  select
    d.id as deal_id,
    jsonb_strip_nulls(jsonb_object_agg(target.key, to_jsonb(target.text_value))) as utm
  from public.deals d
       cross join lateral jsonb_array_elements(coalesce(d.amo_custom_fields, '[]'::jsonb)) f
       cross join lateral jsonb_array_elements(coalesce(f -> 'values', '[]'::jsonb)) v
       cross join lateral (
         select
           case f ->> 'field_name'
             when 'utm_source'   then 'source'
             when 'utm_medium'   then 'medium'
             when 'utm_campaign' then 'campaign'
             when 'utm_content'  then 'content'
             when 'utm_term'     then 'term'
             when 'UTM_ID'       then 'utm_id'
             when 'fbclid'       then 'fbclid'
             when 'FORMNAME'     then 'form'
             when 'TRANID'       then 'tranid'
             when '_ym_uid'      then 'ym_uid'
             when 'referrer'     then 'referrer'
             when 'gclid'        then 'gclid'
           end as key,
           btrim(v.value ->> 'value') as text_value
       ) target
  where d.amo_custom_fields is not null
    and target.key is not null
    and coalesce(target.text_value, '') <> ''
  group by d.id
)
update public.deals d
set utm = attribution.utm
from attribution
where attribution.deal_id = d.id
  and d.utm is distinct from attribution.utm;

-- 5. Кампания Meta вытаскивается из utm_id: по ней отчётность сводится с Ads Manager.
update public.deals d
set meta_campaign_id = d.utm ->> 'utm_id'
where d.utm ? 'utm_id'
  and d.meta_campaign_id is distinct from (d.utm ->> 'utm_id');
