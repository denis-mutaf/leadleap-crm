-- QA / тикет 51, пункт 1 (B-07): источник сделки из меток и source_id Amo.
--
-- Импорт положил в deals.amo_source_id только числовой source_id Amo, а deals.source_id
-- (справочник «Источники» CRM) оставил пустым у всех 5 749 сделок из Amo. Канал обращения
-- в Amo живёт в метках сделки (fbform, tilda, «сообщение (paid)», звонок, ...) и в
-- source_id лида. Данные берутся из закрытой таблицы amo_import_records — в Amo ходить
-- не нужно.
--
-- Правила (по убыванию силы):
--  1. Метка-источник. Если меток-источников несколько, побеждает самая «специфичная»:
--     tiktok > знакомые/рекомендация > с улицы > whatsapp > viber > fbform > сообщение >
--     tilda/сайт (заявка)/marquiz > звонок («звонок» Amo ставит автоматически, это самая
--     слабая метка). Пары fbform+tilda разбираются по source_id лида: если source_id
--     указывает на форму сайта (23491781) — «Форма сайта», на Lead Ads (23490579, 23492339) —
--     «Meta Lead Ads».
--  2. «сообщение (paid)/(organic)» уточняется по source_id чата: 23490583 и 23490585 —
--     Instagram, 23490587 и 23490589 — Facebook (подтверждено origin сообщений в
--     событиях Amo: instagram_business / facebook). Нет различимого чата — новый
--     источник «Сообщение Meta».
--  3. Меток-источников нет — по source_id лида, только если он однозначный (доля >95% в
--     данных): Lead Ads, Форма сайта, чаты Instagram/Facebook, 23492329 → Звонок.
--     source_id 23492611 («прочее», 78% звонков) не используется: сделка остаётся
--     без источника.
-- Пишет только там, где source_id пуст. Повторный запуск ничего не меняет.
-- Служебные триггеры (updated_at, аудит, гейты) выключены: это перенос данных, а не
-- действие менеджера, «обновлено» у сделок не двигается.

set lock_timeout = '3s';
set session_replication_role = replica;

-- Справочник: TikTok и общий Meta-мессенджер в справочнике нет.
insert into public.sources (code, name, is_active)
values ('tiktok', 'TikTok', true),
       ('meta_messenger', 'Сообщение Meta', true)
on conflict (code) do nothing;

with tag_rule(tag, code, prio) as (values
  ('tiktok',                'tiktok',         1),
  ('знакомые/рекомендация', 'referral',       2),
  ('с улицы',               'walk_in',        3),
  ('mesaj whatsapp',        'whatsapp',       4),
  ('mesaj viber',           'viber',          5),
  ('fbform',                'lead_ads',       6),
  ('сообщение (paid)',      'meta_messenger', 7),
  ('сообщение (organic)',   'meta_messenger', 7),
  ('tilda',                 'web_form',       8),
  ('сайт (заявка)',         'web_form',       8),
  ('marquiz',               'web_form',       8),
  ('звонок',                'phone',          9)
), sid_rule(sid, code, kind) as (values
  ('23490583', 'instagram', 'messenger'),
  ('23490585', 'instagram', 'messenger'),
  ('23490587', 'facebook',  'messenger'),
  ('23490589', 'facebook',  'messenger'),
  ('23490579', 'lead_ads',  'form'),
  ('23492339', 'lead_ads',  'form'),
  ('23491781', 'web_form',  'form'),
  ('23490967', 'web_form',  'form'),
  ('23492329', 'phone',     'phone')
), lead as (
  select l.amo_id::bigint as lead_id,
         l.payload ->> 'source_id' as sid,
         case when jsonb_typeof(l.payload -> '_embedded' -> 'tags') = 'array'
              then l.payload -> '_embedded' -> 'tags' else '[]'::jsonb end as tags
  from public.amo_import_records l
  where l.entity_type = 'lead'
), by_tag as (
  select distinct on (lead.lead_id) lead.lead_id, r.code
  from lead
       cross join lateral jsonb_array_elements(lead.tags) t
       join tag_rule r on r.tag = t ->> 'name'
       left join sid_rule s on s.sid = lead.sid and s.kind = 'form'
  order by lead.lead_id, (s.code = r.code) desc nulls last, r.prio
), picked as (
  select lead.lead_id,
         case when bt.code = 'meta_messenger' then coalesce(sm.code, 'meta_messenger')
              else coalesce(bt.code, sf.code) end as code
  from lead
       left join by_tag bt on bt.lead_id = lead.lead_id
       left join sid_rule sm on sm.sid = lead.sid and sm.kind = 'messenger'
       left join sid_rule sf on sf.sid = lead.sid
)
update public.deals d
   set source_id = s.id
  from picked p
       join public.sources s on s.code = p.code
 where d.amo_id = p.lead_id
   and d.source_id is null
   and p.code is not null
   -- не ждём чужих блокировок: занятые менеджером строки дойдут при повторном запуске
   and d.id in (
     select x.id from public.deals x
      where x.amo_id is not null and x.source_id is null
      order by x.id
      for update skip locked
   );

reset session_replication_role;
