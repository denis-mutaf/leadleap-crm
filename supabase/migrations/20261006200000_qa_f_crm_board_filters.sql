-- QA / тикет 57 (раздел «Канбан»): фильтры доски на сервере.
--   * p_tags     — мультивыбор меток (любая из выбранных);
--   * p_created_from / p_created_to — период по дате создания сделки (Europe/Chisinau);
--   * p_column   — страница только одной колонки (подгрузка прокруткой).
-- Старые параметры и их порядок сохранены, новые идут с default null: клиент
-- до выкладки продолжает работать. Тело — из прода (pg_get_functiondef) с тремя
-- точечными вставками.

drop function if exists public.crm_board(integer, integer, uuid, uuid, uuid, uuid, text, text);

CREATE FUNCTION public.crm_board(p_page integer DEFAULT 0, p_page_size integer DEFAULT 24, p_owner uuid DEFAULT NULL::uuid, p_project uuid DEFAULT NULL::uuid, p_tag uuid DEFAULT NULL::uuid, p_source uuid DEFAULT NULL::uuid, p_flag text DEFAULT NULL::text, p_sort text DEFAULT 'updated'::text,
  p_tags uuid[] DEFAULT NULL::uuid[], p_created_from date DEFAULT NULL::date,
  p_created_to date DEFAULT NULL::date, p_column text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
return (
with visible as materialized (
  select d.id, d.contact_id, d.owner_id, d.stage_id, d.status, d.title, d.object_text,
         d.source_id, d.budget, d.budget_currency, d.down_payment_text,
         d.monthly_payment_text, d.postponed_until, d.updated_at, d.created_at
  from deals d
  where d.deleted_at is null
    and (p_owner   is null or d.owner_id  = p_owner)
    and (p_source  is null or d.source_id = p_source)
    and (p_project is null or exists (
          select 1 from deal_projects dp
          where dp.deal_id = d.id and dp.project_id = p_project))
    and (p_tag is null or exists (
          select 1 from deal_tags dt
          where dt.deal_id = d.id and dt.tag_id = p_tag))
    -- Несколько меток: подходит сделка хотя бы с одной из выбранных.
    and (p_tags is null or cardinality(p_tags) = 0 or exists (
          select 1 from deal_tags dt
          where dt.deal_id = d.id and dt.tag_id = any (p_tags)))
    -- Дата создания по часовому поясу отдела, границы включительно.
    and (p_created_from is null
         or d.created_at >= (p_created_from::timestamp at time zone 'Europe/Chisinau'))
    and (p_created_to is null
         or d.created_at <  ((p_created_to + 1)::timestamp at time zone 'Europe/Chisinau'))
    and (
      p_flag is null
      or (p_flag = 'no_next_step' and d.status = 'open' and not exists (
            select 1 from tasks t where t.deal_id = d.id and t.done_at is null))
      or (p_flag = 'overdue' and exists (
            select 1 from tasks t
            where t.deal_id = d.id and t.done_at is null and t.due_at < now()))
      or (p_flag = 'today' and exists (
            select 1 from tasks t
            where t.deal_id = d.id and t.done_at is null
              and t.due_at >= date_trunc('day', now())
              and t.due_at <  date_trunc('day', now()) + interval '1 day'))
    )
),
ranked as materialized (
  select
    v.*,
    k.column_key,
    count(*)      over (partition by k.column_key) as column_total,
    sum(v.budget) over (partition by k.column_key) as column_sum,
    row_number() over (
      partition by k.column_key
      order by
        case when p_sort = 'budget'  then v.budget     end desc nulls last,
        case when p_sort = 'created' then v.created_at end desc nulls last,
        case when p_sort = 'contact'
             then (select c.full_name from contacts c where c.id = v.contact_id)
        end asc nulls last,
        v.updated_at desc,
        v.id
    ) as rn
  from visible v
  cross join lateral (select case
      when v.owner_id is null and v.status not in ('won', 'lost') then 'kettle'
      else v.stage_id::text
    end as column_key) k
),
page as (
  select * from ranked
  where rn >  p_page * p_page_size
    and rn <= (p_page + 1) * p_page_size
    -- Подгрузка прокруткой просит страницу одной колонки, а не всей доски.
    and (p_column is null or column_key = p_column)
),
cards as (
  select
    r.column_key,
    r.rn,
    jsonb_build_object(
      'id',                 r.id,
      'contact_id',         r.contact_id,
      'contact_name',       contact.full_name,
      'owner_id',           r.owner_id,
      'owner_name',         owner.full_name,
      'stage_id',           r.stage_id,
      'status',             r.status,
      'title',              r.title,
      'object_text',        r.object_text,
      'source_name',        source.name,
      'budget',             r.budget,
      'budget_currency',    r.budget_currency,
      'down_payment_text',  r.down_payment_text,
      'monthly_payment_text', r.monthly_payment_text,
      'postponed_until',    r.postponed_until,
      'updated_at',         r.updated_at,
      'created_at',         r.created_at,
      'phone',              phone.phone,
      'tags',               coalesce(tags.list,     '[]'::jsonb),
      'projects',           coalesce(projects.list, '[]'::jsonb),
      'next_task',          next_task.card,
      'last_activity',      activity.card
    ) as card
  from page r
    left join lateral (
      select c.full_name from contacts c where c.id = r.contact_id
    ) contact on true
    left join lateral (
      select pr.full_name from profiles pr where pr.id = r.owner_id
    ) owner on true
    left join lateral (
      select s.name from sources s where s.id = r.source_id
    ) source on true
    left join lateral (
      select cp.phone from contact_phones cp
      where cp.contact_id = r.contact_id
      order by cp.is_primary desc nulls last
      limit 1
    ) phone on true
    left join lateral (
      -- Сначала метки этой сделки, потом их имена: иначе планировщик шёл по всем
      -- 53 меткам и на каждую искал связь — 30 тыс. обращений на страницу доски.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) as list
      from (select dt.tag_id from deal_tags dt where dt.deal_id = r.id offset 0) dt
      join tags t on t.id = dt.tag_id
    ) tags on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', p2.id, 'code', p2.code, 'name', p2.name)
                       order by p2.position) as list
      from deal_projects dp join projects p2 on p2.id = dp.project_id
      where dp.deal_id = r.id
    ) projects on true
    left join lateral (
      select jsonb_build_object('title', t.title, 'due_at', t.due_at) as card
      from tasks t
      where t.deal_id = r.id and t.done_at is null
      order by t.due_at
      limit 1
    ) next_task on true
    left join lateral (
      select jsonb_build_object('kind', a.kind, 'text', a.text, 'at', a.at) as card
      from (
        select 'note' as kind, left(n.body, 120) as text, n.created_at as at
        from notes n
        where n.deal_id = r.id and n.deleted_at is null
          -- Импорт завёл по заметке-двойнику на каждый звонок («Исходящий звонок»).
          and (n.amo_note_type is null or n.amo_note_type not in ('call_in', 'call_out'))
        union all
        select 'call', coalesce(c2.direction::text, 'звонок'), c2.started_at
        from calls c2 where c2.deal_id = r.id
        union all
        select 'stage', null, st.changed_at
        from stage_transitions st where st.deal_id = r.id
        union all
        select 'created', null, r.created_at
      ) a
      -- Заметка и звонок выше смены этапа и создания независимо от свежести.
      order by (case when a.kind in ('note', 'call') then 0 else 1 end),
               a.at desc nulls last
      limit 1
    ) activity on true
),
card_lists as (
  select column_key, jsonb_agg(card order by rn) as deals
  from cards
  group by column_key
),
columns as (
  select
    r.column_key,
    max(r.column_total) as total,
    max(r.column_sum)   as sum
  from ranked r
  group by r.column_key
),
open_tasks as (
  -- Флаги открытых задач одним проходом по задачам, а не три EXISTS на сделку.
  select
    t.deal_id,
    bool_or(t.due_at < now()) as overdue,
    bool_or(t.due_at >= date_trunc('day', now())
            and t.due_at < date_trunc('day', now()) + interval '1 day') as today
  from tasks t
  where t.done_at is null and t.deal_id is not null
  group by t.deal_id
),
counters as (
  select
    count(*) filter (where v.status = 'open' and ot.deal_id is null) as no_next_step,
    count(*) filter (where ot.overdue)                               as overdue,
    count(*) filter (where ot.today)                                 as today
  from visible v
  left join open_tasks ot on ot.deal_id = v.id
)
select jsonb_build_object(
  'columns', (
    select coalesce(jsonb_object_agg(
      c.column_key,
      jsonb_build_object(
        'total', c.total,
        'sum',   c.sum,
        'deals', coalesce(cl.deals, '[]'::jsonb)
      )
    ), '{}'::jsonb)
    from columns c
    left join card_lists cl on cl.column_key = c.column_key
  ),
  'counters', (select to_jsonb(counters) from counters),
  'total',    (select count(*) from visible)
));
end;
$function$;

revoke all on function public.crm_board(integer, integer, uuid, uuid, uuid, uuid, text, text, uuid[], date, date, text) from public, anon;
grant execute on function public.crm_board(integer, integer, uuid, uuid, uuid, uuid, text, text, uuid[], date, date, text) to authenticated, service_role;
