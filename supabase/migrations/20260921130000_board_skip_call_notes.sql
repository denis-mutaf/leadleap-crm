-- Карточка воронки показывала «Заметка: Исходящий звонок» вместо настоящей
-- заметки: импорт Amo завёл по заметке на каждый звонок, и таких заметок 7502 —
-- больше половины таблицы. Звонок на карточке и так показан своей строкой.
-- Карточка сделки эти заметки уже отфильтровывала по amo_note_type, доска — нет.

create or replace function public.crm_board(
  p_page      int    default 0,
  p_page_size int    default 24,
  p_owner     uuid   default null,
  p_project   uuid   default null,
  p_tag       uuid   default null,
  p_source    uuid   default null,
  p_flag      text   default null,   -- no_next_step | overdue | today
  p_sort      text   default 'updated' -- updated | created | budget | contact
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with visible as (
  select d.*
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
placed as (
  select
    v.*,
    case
      when v.owner_id is null and v.status not in ('won', 'lost') then 'kettle'
      else v.stage_id::text
    end as column_key
  from visible v
),
ranked as (
  select
    p.*,
    count(*)    over (partition by p.column_key) as column_total,
    sum(p.budget) over (partition by p.column_key) as column_sum,
    row_number() over (
      partition by p.column_key
      order by
        case when p_sort = 'budget'  then p.budget     end desc nulls last,
        case when p_sort = 'created' then p.created_at end desc nulls last,
        case when p_sort = 'contact'
             then (select c.full_name from contacts c where c.id = p.contact_id)
        end asc nulls last,
        p.updated_at desc
    ) as rn
  from placed p
),
page as (
  select * from ranked
  where rn >  p_page * p_page_size
    and rn <= (p_page + 1) * p_page_size
),
cards as (
  select
    r.column_key,
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
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) as list
      from deal_tags dt join tags t on t.id = dt.tag_id
      where dt.deal_id = r.id
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
          -- Импорт завёл по заметке на каждый звонок с текстом «Исходящий
          -- звонок»: 7502 штуки, половина всей таблицы. Звонок на карточке уже
          -- показан своей строкой, а «Заметка: Исходящий звонок» затирала
          -- настоящую заметку, которую написал менеджер.
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
      -- Заметка и звонок — это то, что сделал человек, и у них есть текст.
      -- Смена этапа и создание сделки стоят ниже независимо от свежести:
      -- иначе «Этап изменён» затирает «Заметка: interes 1, cu 10%».
      order by (case when a.kind in ('note', 'call') then 0 else 1 end),
               a.at desc nulls last
      limit 1
    ) activity on true
),
columns as (
  select
    r.column_key,
    max(r.column_total) as total,
    max(r.column_sum)   as sum
  from ranked r
  group by r.column_key
),
counters as (
  select
    count(*) filter (
      where v.status = 'open'
        and not exists (select 1 from tasks t where t.deal_id = v.id and t.done_at is null)
    ) as no_next_step,
    count(*) filter (
      where exists (select 1 from tasks t
                    where t.deal_id = v.id and t.done_at is null and t.due_at < now())
    ) as overdue,
    count(*) filter (
      where exists (select 1 from tasks t
                    where t.deal_id = v.id and t.done_at is null
                      and t.due_at >= date_trunc('day', now())
                      and t.due_at <  date_trunc('day', now()) + interval '1 day')
    ) as today
  from visible v
)
select jsonb_build_object(
  'columns', (
    select coalesce(jsonb_object_agg(
      c.column_key,
      jsonb_build_object(
        'total', c.total,
        'sum',   c.sum,
        'deals', coalesce((select jsonb_agg(cards.card) from cards where cards.column_key = c.column_key), '[]'::jsonb)
      )
    ), '{}'::jsonb)
    from columns c
  ),
  'counters', (select to_jsonb(counters) from counters),
  'total',    (select count(*) from visible)
);
$$;

comment on function public.crm_board is
  'Срез доски сделок одним вызовом: колонки, счётчики и страница карточек с уже подтянутыми связями.';

grant execute on function public.crm_board(int, int, uuid, uuid, uuid, uuid, text, text) to authenticated;
