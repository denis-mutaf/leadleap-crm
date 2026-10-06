-- QA / тикет 51, пункт 7 (B-19, раздел C отчёта): дубли полей комнатности и «Телефон источника».
--
-- Сейчас у сделки три места «сколько комнат»:
--   deals.rooms                          — «Комнатность» (1 / 2 / 3 / 4 и больше), её видит карточка,
--                                          фильтры и гейт квалификации; заполнена у 1 865 сделок;
--   custom «Сколько комнат интересует»   — rooms_wanted, текст из Amo («Хочу кол-во комнат» и
--                                          румынская форма), 2 809 сделок;
--   custom «Количество комнат»           — room_count, 1 запись (поле Amo «Количество комнат»).
-- Каноническое поле — deals.rooms. Слияние:
--   1. Из rooms_wanted в deals.rooms — где rooms пуст и в тексте ровно одно число комнат
--      («2», «2 camere + living (de la 67m2)», «1 camera si living»). «4 и больше» —
--      значения ≥ 4 сжимаются в 4, как в справочнике карточки. Диапазоны и перечисления
--      («1-2», «2 camere…; 3 camere…») в rooms не пишутся — это не одно значение.
--   2. Исходный текст не пропадает: всё, что не чистое число, копируется в deals.rooms_text
--      (там, где он пуст). Сейчас карточка rooms_text не показывает — вывод остаётся
--      за интерфейсом.
--   3. Значение room_count переезжает в deals.rooms там, где оно пусто.
--   4. Поля rooms_wanted и room_count скрываются из «Пользовательских полей» (is_active =
--      false). Значения НЕ удаляются: включение поля обратно возвращает всё как было.
-- «Телефон источника» (source_phone, 817 сделок, значения — номер входящей линии
-- +37361030040 / +37361030030) дублем чего-либо не является. Данные копируются в
-- deals.utm.source_phone, чтобы номер был в атрибуции сделки, а сама настройка поля
-- оставлена как есть — показывать ли её в карточке, решает владелец.
-- Тестовые значения «<test lead: dummy data…>» пропускаются.
-- Пишет только в пустое; повторный запуск ничего не меняет. Триггеры deals выключены.

set lock_timeout = '3s';
set session_replication_role = replica;

-- 1-2. rooms_wanted → deals.rooms и deals.rooms_text
with fv as (
  select v.entity_id as deal_id, btrim(v.value #>> '{}') as val
    from public.custom_field_values v
         join public.custom_field_defs f on f.id = v.field_id and f.entity = 'deal' and f.key = 'rooms_wanted'
   where btrim(coalesce(v.value #>> '{}', '')) <> ''
), parsed as (
  select fv.deal_id, fv.val,
         case when fv.val ~ '^\d{1,2}$' then array[fv.val::int]
              else (select array_agg(distinct m[1]::int)
                      from regexp_matches(fv.val, '(\d{1,2})\s*(?:camer|комн)', 'gi') as m)
         end as nums
    from fv
   where fv.val !~* 'test lead|dummy data'
), decided as (
  select deal_id, val,
         case when cardinality(nums) = 1 and nums[1] between 1 and 20
              then least(nums[1], 4)::smallint end as rooms_new,
         (val !~ '^\d{1,2}$') as keep_text
    from parsed
), target as (
  select d.id
    from decided x
         join public.deals d on d.id = x.deal_id
   where (d.rooms is null and x.rooms_new is not null)
      or (d.rooms_text is null and x.keep_text)
   order by d.id
     for update of d skip locked
)
update public.deals d
   set rooms = coalesce(d.rooms, x.rooms_new),
       rooms_text = case when d.rooms_text is null and x.keep_text then x.val else d.rooms_text end
  from decided x
       join target t on t.id = x.deal_id
 where d.id = x.deal_id;

-- 3. room_count → deals.rooms
update public.deals d
   set rooms = least(round((v.value #>> '{}')::numeric), 4)::smallint
  from public.custom_field_values v
       join public.custom_field_defs f on f.id = v.field_id and f.entity = 'deal' and f.key = 'room_count'
 where v.entity_id = d.id
   and d.rooms is null
   and (v.value #>> '{}') ~ '^\d{1,2}(\.\d+)?$'
   and round((v.value #>> '{}')::numeric) >= 1;

-- «Телефон источника» → deals.utm.source_phone
with sp as (
  select v.entity_id as deal_id, btrim(v.value #>> '{}') as val
    from public.custom_field_values v
         join public.custom_field_defs f on f.id = v.field_id and f.entity = 'deal' and f.key = 'source_phone'
   where btrim(coalesce(v.value #>> '{}', '')) <> ''
     and (v.value #>> '{}') !~* 'test lead|dummy data'
), target as (
  select d.id
    from sp
         join public.deals d on d.id = sp.deal_id
   where not (coalesce(d.utm, '{}'::jsonb) ? 'source_phone')
   order by d.id
     for update of d skip locked
)
update public.deals d
   set utm = coalesce(d.utm, '{}'::jsonb) || jsonb_build_object('source_phone', sp.val)
  from sp
       join target t on t.id = sp.deal_id
 where d.id = sp.deal_id;

-- 4. Скрыть дубли комнатности (значения остаются в custom_field_values)
update public.custom_field_defs
   set is_active = false
 where entity = 'deal'
   and key in ('rooms_wanted', 'room_count')
   and is_active;

reset session_replication_role;
