-- QA / тикет 51, пункт 8 (B-19): мусор в справочниках после переноса из Amo.
--
-- 1. Причина отказа «Не указана в Amo» — служебная заглушка импорта (48 закрытых
--    сделок без причины в Amo). Выключается (is_active = false): новые закрытия её в списке
--    не увидят, а у 48 старых сделок причина остаётся и читается по id (карточка достаёт
--    имя причины отдельным запросом, отчёт по отказам читает справочник без фильтра).
-- 2. Метки-дубли месяцев из Amo сливаются в основную: iul → iulie, au → august, ma → mai.
--    По сути это та же операция, что merge_crm_tag из «Настроек → Справочники», только
--    без вызова пользователя (в миграции нет роли): связи сделок и контактов переносятся
--    на основную метку (дубли связей пропускаются), лишняя метка уходит в архив
--    (is_active = false, merged_into = основная), в журнал пишется запись «merge».
--    На проде у iul / au / ma сейчас 0 связей (метки есть только в справочнике Amo), так
--    что переносить нечего — но миграция переносит, если связи появились к моменту применения.
--    Метка na (0 связей) в задание не входила и не трогается.
-- Пишет только в активное; повторный запуск ничего не меняет.

set lock_timeout = '3s';

update public.lost_reasons
   set is_active = false
 where name = 'Не указана в Amo'
   and amo_id is null
   and is_active;

with pairs(source_name, target_name) as (values
  ('iul', 'iulie'),
  ('au',  'august'),
  ('ma',  'mai')
), pick as (
  select s.id as source_id, t.id as target_id, s.name as source_name, t.name as target_name
    from pairs p
         join public.tags s on s.name = p.source_name and s.is_active
         join public.tags t on t.name = p.target_name and t.is_active
), moved_deals as (
  insert into public.deal_tags (deal_id, tag_id, created_by, created_at)
  select dt.deal_id, p.target_id, dt.created_by, dt.created_at
    from pick p join public.deal_tags dt on dt.tag_id = p.source_id
  on conflict (deal_id, tag_id) do nothing
  returning 1
), moved_contacts as (
  insert into public.contact_tags (contact_id, tag_id, created_by, created_at)
  select ct.contact_id, p.target_id, ct.created_by, ct.created_at
    from pick p join public.contact_tags ct on ct.tag_id = p.source_id
  on conflict (contact_id, tag_id) do nothing
  returning 1
), cleared_deals as (
  delete from public.deal_tags dt using pick p where dt.tag_id = p.source_id
  returning 1
), cleared_contacts as (
  delete from public.contact_tags ct using pick p where ct.tag_id = p.source_id
  returning 1
), archived as (
  update public.tags t
     set is_active = false, merged_into = p.target_id
    from pick p
   where t.id = p.source_id
  returning t.id as source_id, p.target_id, p.source_name, p.target_name
)
insert into public.audit_log (entity, entity_id, action, actor_id, changes)
select 'tag', a.source_id, 'merge', null,
       jsonb_build_object('source_name', a.source_name,
                          'target_id', a.target_id,
                          'target_name', a.target_name,
                          'deal_links', (select count(*) from cleared_deals),
                          'contact_links', (select count(*) from cleared_contacts),
                          'by', 'amo_backfill')
  from archived a;
