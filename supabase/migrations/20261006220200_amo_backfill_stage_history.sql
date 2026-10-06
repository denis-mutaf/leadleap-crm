-- QA / тикет 51, пункт 3 (B-07): история этапов из событий Amo.
--
-- Проверено на проде: из 2 348 событий lead_status_changed в закрытом снимке
-- 2 323 уже лежат в stage_transitions (amo_event_id), даты и авторы совпадают с
-- событиями, 25 относятся к сделкам, которых нет в экспорте (удалены в Amo).
-- Новых строк эта миграция на сегодняшних данных не добавит: она закрепляет
-- результат (страховка на случай повторной загрузки снимка) и дозаливает только то,
-- чего ещё нет. «Пустая» история у остальных 4 429 сделок — не потеря: Amo отдаёт
-- события только с 20.05.2026, а сделки заведены с 02.06.2025.
--
-- Дата перехода — дата события Amo (created_at). Автор — профиль с тем же amo_id
-- (prepare-amo-users.ts); у событий от робота Amo (created_by = 0) автора нет.
-- Статусы from/to берутся из вида этапа (open / won / lost), как в
-- import-amo-stage-history.ts. Дубли исключены уникальным amo_event_id.
-- Триггеров на stage_transitions нет; deals не трогаем.

set lock_timeout = '3s';

insert into public.stage_transitions
  (deal_id, from_stage_id, to_stage_id, from_status, to_status, changed_by, changed_at, amo_event_id)
select d.id,
       mf.stage_id,
       mt.stage_id,
       sf.kind::text::public.deal_status,
       st.kind::text::public.deal_status,
       p.id,
       to_timestamp((e.payload ->> 'created_at')::bigint),
       e.payload ->> 'id'
  from public.amo_import_records e
       join public.deals d on d.amo_id = (e.payload ->> 'entity_id')::bigint
       join public.amo_stage_map mf
         on mf.amo_status_id = (e.payload -> 'value_before' -> 0 -> 'lead_status' ->> 'id')::bigint
       join public.amo_stage_map mt
         on mt.amo_status_id = (e.payload -> 'value_after' -> 0 -> 'lead_status' ->> 'id')::bigint
       join public.stages sf on sf.id = mf.stage_id
       join public.stages st on st.id = mt.stage_id
       left join public.profiles p
         on p.amo_id = nullif((e.payload ->> 'created_by')::bigint, 0)
 where e.entity_type = 'event'
   and e.payload ->> 'type' = 'lead_status_changed'
   and e.payload ->> 'entity_type' = 'lead'
on conflict (amo_event_id) do nothing;
