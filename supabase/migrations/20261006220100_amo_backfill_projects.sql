-- QA / тикет 51, пункт 2 (B-07): проект сделки.
--
-- В Amo нет поля «Проект»: ни среди 48 полей сделок (lead_field), ни в
-- custom_fields_values 5 749 лидов. Проект раньше проставлялся только по этапу
-- «Резервация» (четыре статуса Amo = Select / Next / новый объект / D. Tudor),
-- это уже сделано при импорте (48 сделок). Здесь добираются сделки, у которых проект
-- читается из данных Amo косвенно и однозначно:
--   Next   — метка «next», либо имя сделки со ссылкой isragrup.md/(ru|ro)/next, либо
--            форма FORMNAME со словом next;
--   Select — имя сделки «Lead from: ...selectnewtown.isragrup.md...» (форма на сайте
--            проекта), либо значение поля «ЖК» = Select New Town.
-- Сделка с обоими сигналами (на проде таких 0) пропускается — решает менеджер.
-- «Проект» — одиночный выбор: сделка, у которой проект уже есть, не трогается.
-- «Новый объект» как этап воронки (amo:stage:80) проектом не подменяется: сигнал
-- «new_object» здесь не используется вообще.
-- Пишет только там, где проекта нет. Повторный запуск ничего не меняет.

set lock_timeout = '3s';
set session_replication_role = replica;

with lead as (
  select l.amo_id::bigint as lead_id,
         l.payload ->> 'name' as name,
         case when jsonb_typeof(l.payload -> '_embedded' -> 'tags') = 'array'
              then l.payload -> '_embedded' -> 'tags' else '[]'::jsonb end as tags,
         case when jsonb_typeof(l.payload -> 'custom_fields_values') = 'array'
              then l.payload -> 'custom_fields_values' else '[]'::jsonb end as cf
  from public.amo_import_records l
  where l.entity_type = 'lead'
), sig as (
  select lead_id,
         (exists (select 1 from jsonb_array_elements(tags) t where t ->> 'name' = 'next')
          or name ~* '(^|[^a-z0-9])isragrup\.md/(ru/|ro/)?next([^a-z]|$)'
          or exists (select 1 from jsonb_array_elements(cf) f
                      where f ->> 'field_name' = 'FORMNAME'
                        and f -> 'values' -> 0 ->> 'value' ~* 'next')) as is_next,
         (name ~* 'selectnewtown\.isragrup\.md'
          or exists (select 1 from jsonb_array_elements(cf) f
                      where f ->> 'field_name' = 'ЖК'
                        and f -> 'values' -> 0 ->> 'value' ~* 'select')) as is_select
  from lead
), pick as (
  select lead_id,
         case when is_next and not is_select then 'next'
              when is_select and not is_next then 'select' end as code
  from sig
)
insert into public.deal_projects (deal_id, project_id)
select d.id, pr.id
  from pick p
       join public.deals d on d.amo_id = p.lead_id and d.deleted_at is null
       join public.projects pr on pr.code = p.code
 where p.code is not null
   and not exists (select 1 from public.deal_projects dp where dp.deal_id = d.id)
on conflict (deal_id, project_id) do nothing;

reset session_replication_role;
