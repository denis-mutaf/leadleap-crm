-- QA / тикет 51, пункт 4 (B-07): звонки Amo в карточке сделки.
--
-- Звонки Amo уже перенесены в таблицу calls: 7 502 строки с external_id
-- 'amo-note:<id>', параметры Amo лежат в raw. Но у 7 286 из них нет deal_id (в Amo звонок
-- висит на контакте), а карточка сделки читает calls по deal_id — поэтому «звонков 0».
-- Новые записи не создаются, записи разговоров не качаются — только привязка.
--
-- Правило привязки: сделка из deal_contacts звонящего контакта.
--  - сделка одна — она;
--  - сделок несколько — та, что была открыта на момент звонка (создана до звонка и не
--    закрыта к этому времени); иначе самая свежая из созданных до звонка; иначе самая
--    ранняя из созданных позже (звонок до заведения сделки).
-- Звонок контакта без сделок остаётся только на контакте. Звонки с deal_id (216) и
-- звонки PBX (external_id не 'amo-note:%') не трогаются. Повторный запуск ничего не меняет.
-- calls_bump_contact_activity / calls_close_missed на UPDATE выключены: старый звонок не
-- должен сдвигать «последнюю активность» контакта и закрывать «Перезвонить».

set lock_timeout = '3s';
set session_replication_role = replica;

with c as (
  select k.id as call_id, k.contact_id, k.started_at
    from public.calls k
   where k.external_id like 'amo-note:%'
     and k.deal_id is null
     and k.contact_id is not null
), cand as (
  select c.call_id, d.id as deal_id, c.started_at, d.created_at, d.closed_at
    from c
         join public.deal_contacts dc on dc.contact_id = c.contact_id
         join public.deals d on d.id = dc.deal_id and d.deleted_at is null
), pick as (
  select distinct on (call_id) call_id, deal_id
    from cand
   order by call_id,
            (created_at <= started_at and (closed_at is null or closed_at >= started_at)) desc,
            (created_at <= started_at) desc,
            case when created_at <= started_at then created_at end desc nulls last,
            created_at asc,
            deal_id
)
update public.calls k
   set deal_id = p.deal_id
  from pick p
 where k.id = p.call_id
   and k.deal_id is null
   and k.id in (
     select x.id from public.calls x
      where x.external_id like 'amo-note:%' and x.deal_id is null
      order by x.id
      for update skip locked
   );

reset session_replication_role;
