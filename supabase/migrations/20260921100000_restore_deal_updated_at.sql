-- Бэкфилл UTM (20260921070000) тронул 1551 сделку, и триггер touch_updated_at
-- проставил им сегодняшнюю дату. Воронка сортируется по updated_at, поэтому
-- полторы тысячи старых лидов встали наверх, а колонка «Обновлена» в таблице
-- показывала одно и то же время у всех.
--
-- Восстанавливаем из сырого импорта Amo: amo_import_records.payload->>'updated_at'
-- (unix). Правим только строки, помеченные сегодняшним днём, — их никто, кроме
-- миграции, не трогал: CRM ещё не в работе. Триггеры на время правки выключены,
-- иначе touch_updated_at перезапишет значение обратно.
alter table public.deals disable trigger user;

update public.deals d
   set updated_at = to_timestamp((r.payload->>'updated_at')::bigint)
  from public.amo_import_records r
 where r.entity_type = 'lead'
   and r.amo_id = d.amo_id::text
   and r.payload->>'updated_at' is not null
   and d.updated_at::date = date '2026-09-21';

alter table public.deals enable trigger user;
