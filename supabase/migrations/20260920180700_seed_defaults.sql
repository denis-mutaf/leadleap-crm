-- Стартовое наполнение справочников. Это дефолт владельца, а не решение заказчика:
-- заказчик правит этапы и списки в живой системе, разработчик для этого не нужен.

insert into projects (code, name, position) values
  ('select', 'Select New Town', 10),
  ('next',   'Next New Town',   20)
on conflict (code) do nothing;

-- Воронка. Гейт квалификации стоит на Презентации: документ называет переход
-- «Квалификация → Презентация» основным затыком отдела.
insert into stages (name, position, kind, requires_qualification, requires_next_step) values
  ('Новое обращение',      10, 'open', false, false),
  ('Квалификация',         20, 'open', false, true),
  ('Презентация',          30, 'open', true,  true),
  ('Показ на площадке',    40, 'open', true,  true),
  ('Переговоры',           50, 'open', true,  true),
  ('Аванс',                60, 'open', true,  true),
  ('Договор',              70, 'won',  false, false),
  ('Отказ',                80, 'lost', false, false)
on conflict do nothing;

insert into sources (code, name) values
  ('phone',     'Звонок'),
  ('web_form',  'Форма сайта'),
  ('instagram', 'Instagram'),
  ('facebook',  'Facebook'),
  ('whatsapp',  'WhatsApp'),
  ('viber',     'Viber'),
  ('lead_ads',  'Meta Lead Ads'),
  ('manual',    'Заведено вручную')
on conflict (code) do nothing;

insert into task_types (code, name) values
  ('call',         'Звонок'),
  ('meeting',      'Встреча'),
  ('presentation', 'Презентация'),
  ('message',      'Написать в мессенджер'),
  ('documents',    'Документы')
on conflict (code) do nothing;

insert into lost_reasons (name, position) values
  ('Дорого',                          10),
  ('Не подошла планировка',           20),
  ('Не подошёл срок сдачи',           30),
  ('Купил у другого застройщика',     40),
  ('Не одобрили ипотеку',             50),
  ('Передумал покупать',              60),
  ('Не выходит на связь',             70),
  ('Нецелевое обращение',             80)
on conflict do nothing;

insert into settings (key, value) values
  ('sla_first_response', '{"minutes": 30}'::jsonb),
  ('timezone',           '"Europe/Chisinau"'::jsonb),
  ('default_currency',   '"EUR"'::jsonb)
on conflict (key) do nothing;

-- Набор событий по умолчанию. Администратор меняет адресатов и каналы доставки.
insert into notification_rules (kind, notify_owner, notify_role, in_app, email) values
  ('incoming_call', true,  null,   true, false),
  ('new_lead',      true,  null,   true, false),
  ('new_message',   true,  null,   true, false),
  ('sla_breach',    true,  'head', true, false),
  ('task_overdue',  true,  'head', true, false),
  ('postponed_due', true,  null,   true, false)
on conflict do nothing;
