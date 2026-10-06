-- QA тикет 38 / круг 3 E1: «Отложить до…».
-- Статус «отложена» и дата касания в базе уже были, но из интерфейса их нельзя
-- было поставить, а автовозврата не существовало. Что делает файл:
--   1. sync_status_with_stage: ручной переход по этапу или в «Отказ» снимает
--      отложенность (раньше статус postponed переживал любой переход).
--   2. create_touch_task: одна открытая задача касания на сделку. Смена даты
--      переносит её срок, повторное откладывание той же даты не плодит вторую,
--      смена ответственного переназначает; ручное снятие отложенности закрывает
--      задачу. Срок задачи — 09:00 по Кишинёву в день касания.
--   3. postpone_crm_deal / resume_crm_deal — действия из карточки (с правами
--      вызывающего, RLS работает как у обычного UPDATE).
--   4. process_postponed_due() — автовозврат для планировщика (раз в 5 минут).
--   5. crm_deals_table: флаг фильтра «postponed».
-- Дата касания — календарный день отдела (Europe/Chisinau). Автовозврат срабатывает
-- в тот же момент, когда наступает срок задачи касания (09:00 в этот день).

-- 1. Переход по этапу снимает отложенность --------------------------------------
create or replace function public.sync_status_with_stage()
returns trigger
language plpgsql
as $$
declare
  kind stage_kind;
begin
  select s.kind into kind from stages s where s.id = new.stage_id;

  if kind = 'won' then
    new.status := 'won';
  elsif kind = 'lost' then
    new.status := 'lost';
  elsif new.status in ('won', 'lost') then
    -- вернули из закрытого этапа в работу
    new.status := 'open';
  elsif tg_op = 'UPDATE'
        and new.stage_id is distinct from old.stage_id
        and old.status = 'postponed'
        and new.status = 'postponed' then
    -- менеджер двинул сделку по воронке: значит, работа возобновилась
    new.status := 'open';
  end if;

  -- Дата касания имеет смысл только у отложенной сделки.
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id and new.status <> 'postponed' then
    new.postponed_until := null;
  end if;

  return new;
end;
$$;

-- 2. Одна открытая задача касания на сделку -------------------------------------
-- На случай, если дубли уже есть: оставляем самую свежую, остальные закрываем.
with ranked as (
  select id,
         row_number() over (partition by deal_id order by created_at desc, id desc) as rn
    from public.tasks
   where title = 'Касание по отложенной сделке'
     and is_auto
     and done_at is null
     and deleted_at is null
     and deal_id is not null
)
update public.tasks t
   set done_at = now(),
       result_text = 'Дубль: закрыта при чистке задач касания'
  from ranked r
 where t.id = r.id
   and r.rn > 1;

create unique index if not exists tasks_one_open_touch_per_deal
  on public.tasks (deal_id)
  where title = 'Касание по отложенной сделке'
    and is_auto
    and done_at is null
    and deleted_at is null;

create or replace function public.create_touch_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_due timestamptz;
begin
  if new.status = 'postponed'
     and new.postponed_until is not null
     and (old.status is distinct from 'postponed'
          or old.postponed_until is distinct from new.postponed_until
          or old.owner_id is distinct from new.owner_id)
  then
    v_due := (new.postponed_until::timestamp + time '09:00') at time zone 'Europe/Chisinau';

    -- Есть открытая задача касания — переносим срок и ответственного.
    update public.tasks
       set due_at = v_due,
           assignee_id = coalesce(new.owner_id, assignee_id)
     where deal_id = new.id
       and title = 'Касание по отложенной сделке'
       and is_auto
       and done_at is null
       and deleted_at is null
       and (due_at is distinct from v_due or assignee_id is distinct from coalesce(new.owner_id, assignee_id));

    -- Нет открытой — создаём (без ответственного задачу ставить некому).
    if new.owner_id is not null then
      insert into public.tasks (deal_id, contact_id, assignee_id, title, due_at, is_auto, created_by)
      values (new.id, new.contact_id, new.owner_id, 'Касание по отложенной сделке', v_due, true, auth.uid())
      on conflict (deal_id)
        where title = 'Касание по отложенной сделке' and is_auto and done_at is null and deleted_at is null
      do nothing;
    end if;
  end if;

  -- Отложенность сняли вручную (кнопка, переход по этапу): задача касания не нужна.
  -- Автовозврат (process_postponed_due) помечает транзакцию и задачу не трогает:
  -- она и есть то самое касание.
  if old.status = 'postponed'
     and new.status is distinct from 'postponed'
     and coalesce(current_setting('crm.postpone_auto', true), '') <> 'on'
  then
    update public.tasks
       set done_at = now(),
           done_by = auth.uid(),
           result_text = 'Отложенность снята'
     where deal_id = new.id
       and title = 'Касание по отложенной сделке'
       and is_auto
       and done_at is null
       and deleted_at is null;
  end if;

  return new;
end;
$$;

-- 3. Действия из карточки -------------------------------------------------------
create or replace function public.postpone_crm_deal(
  p_deal_id uuid,
  p_until   date,
  p_comment text default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deal    public.deals%rowtype;
  v_today   date := (now() at time zone 'Europe/Chisinau')::date;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_deal from public.deals where id = p_deal_id and deleted_at is null for update;
  if not found then raise exception 'Deal unavailable' using errcode = '42501'; end if;
  if v_deal.status not in ('open', 'postponed') then
    raise exception 'Закрытую сделку отложить нельзя' using errcode = 'check_violation';
  end if;
  if p_until is null or p_until <= v_today then
    raise exception 'Дата касания должна быть в будущем' using errcode = 'check_violation';
  end if;
  if v_comment is not null and length(v_comment) > 2000 then
    raise exception 'Комментарий слишком длинный' using errcode = 'check_violation';
  end if;

  update public.deals
     set status = 'postponed', postponed_until = p_until
   where id = p_deal_id;

  if v_comment is not null then
    insert into public.notes (deal_id, author_id, body)
    values (p_deal_id, auth.uid(),
            'Отложена до ' || to_char(p_until, 'DD.MM.YYYY') || ': ' || v_comment);
  end if;

  return jsonb_build_object('status', 'postponed', 'postponed_until', p_until);
end;
$$;

revoke all on function public.postpone_crm_deal(uuid, date, text) from public, anon;
grant execute on function public.postpone_crm_deal(uuid, date, text) to authenticated, service_role;

create or replace function public.resume_crm_deal(p_deal_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals%rowtype;
begin
  if auth.uid() is null or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_deal from public.deals where id = p_deal_id and deleted_at is null for update;
  if not found then raise exception 'Deal unavailable' using errcode = '42501'; end if;

  -- Уже вернулась (автовозврат или другой менеджер) — не ошибка.
  if v_deal.status = 'postponed' then
    update public.deals set status = 'open', postponed_until = null where id = p_deal_id;
  end if;

  return jsonb_build_object('status', case when v_deal.status = 'postponed' then 'open' else v_deal.status::text end,
                            'postponed_until', null);
end;
$$;

revoke all on function public.resume_crm_deal(uuid) from public, anon;
grant execute on function public.resume_crm_deal(uuid) to authenticated, service_role;

-- 4. Автовозврат ----------------------------------------------------------------
-- Зовёт планировщик (pg_cron, раз в 5 минут). Идемпотентна: вернувшаяся сделка
-- больше не отложена и повторно не берётся. Возвращает число вернувшихся сделок.
create or replace function public.process_postponed_due()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_count  int := 0;
  v_name   text;
  v_notify boolean := public.notification_in_app_enabled('postponed_due');
begin
  perform set_config('crm.postpone_auto', 'on', true);

  for r in
    select d.id, d.owner_id, d.contact_id, d.title, d.postponed_until
      from public.deals d
     where d.status = 'postponed'
       and d.deleted_at is null
       and d.postponed_until is not null
       and (d.postponed_until::timestamp + time '09:00') at time zone 'Europe/Chisinau' <= now()
     order by d.postponed_until, d.id
       for update skip locked
  loop
    update public.deals
       set status = 'open', postponed_until = null
     where id = r.id and status = 'postponed';
    if not found then continue; end if;
    v_count := v_count + 1;

    if v_notify then
      select c.full_name into v_name from public.contacts c where c.id = r.contact_id;
      insert into public.notifications (user_id, kind, title, body, deal_id, contact_id, payload)
      select u,
             'postponed_due',
             'Пора вернуться к сделке: ' || coalesce(nullif(v_name, ''), nullif(r.title, ''), 'без имени'),
             'Дата касания ' || to_char(r.postponed_until, 'DD.MM.YYYY') || ' наступила, сделка снова в работе.',
             r.id,
             r.contact_id,
             jsonb_build_object('deal_id', r.id, 'postponed_until', r.postponed_until)
        from (
          select r.owner_id as u
           where r.owner_id is not null
             and exists (select 1 from public.profiles p where p.id = r.owner_id and p.is_active)
          union
          select pool from public.notification_pool_recipients() pool
           where r.owner_id is null
              or not exists (select 1 from public.profiles p where p.id = r.owner_id and p.is_active)
        ) recipients;
    end if;
  end loop;

  perform set_config('crm.postpone_auto', 'off', true);
  return v_count;
end;
$$;

revoke all on function public.process_postponed_due() from public, anon, authenticated;
grant execute on function public.process_postponed_due() to service_role, postgres;

-- 5. Фильтр «Отложенные» в таблице сделок -------------------------------------
CREATE OR REPLACE FUNCTION public.crm_deals_table(p_q text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid, p_stage uuid DEFAULT NULL::uuid, p_flag text DEFAULT NULL::text, p_sort text DEFAULT 'activity'::text, p_dir text DEFAULT 'desc'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50, p_cf uuid DEFAULT NULL::uuid, p_cfv text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q      text := nullif(btrim(coalesce(p_q, '')), '');
  cf_like text := '%' || replace(replace(replace(coalesce(p_cfv, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  like_q text;
  digits text;
  asc_   boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  if q is not null then
    like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    digits := public.crm_phone_digits(q);
    if length(digits) < 4 then digits := null; end if;
  end if;

  return query
  with base as materialized (
    select d.id, d.contact_id, d.owner_id, d.stage_id, d.created_at, d.updated_at
    from deals d
    where d.deleted_at is null
      and (p_owner is null or d.owner_id = p_owner)
      and (p_stage is null or d.stage_id = p_stage)
      -- Пользовательское поле: текст — по вхождению, остальные типы — точное значение.
      and (p_cf is null or nullif(btrim(coalesce(p_cfv, '')), '') is null or exists (
            select 1
            from custom_field_values v
            join custom_field_defs f on f.id = v.field_id
            where v.entity_id = d.id and v.field_id = p_cf and f.entity = 'deal'
              and case when f.field_type = 'text'
                       then (v.value #>> '{}') ilike cf_like
                       else (v.value #>> '{}') = p_cfv end))
      and (
        p_flag is null
        or (p_flag = 'no_next_step' and d.status = 'open' and not exists (
              select 1 from tasks t where t.deal_id = d.id and t.done_at is null and t.deleted_at is null))
        or (p_flag = 'postponed' and d.status = 'postponed')
        or (p_flag = 'overdue' and exists (
              select 1 from tasks t
              where t.deal_id = d.id and t.done_at is null and t.deleted_at is null and t.due_at < now()))
        or (p_flag = 'today' and exists (
              select 1 from tasks t
              where t.deal_id = d.id and t.done_at is null and t.deleted_at is null
                and t.due_at >= date_trunc('day', now())
                and t.due_at <  date_trunc('day', now()) + interval '1 day'))
      )
      and (
        q is null
        or d.title ilike like_q
        or d.object_text ilike like_q
        or exists (select 1 from contacts c where c.id = d.contact_id and c.full_name ilike like_q)
        or (digits is not null and exists (
              select 1 from contact_phones cp
              where cp.contact_id = d.contact_id and cp.phone like '%' || digits || '%'))
      )
  ),
  keyed as (
    select
      b.id,
      b.created_at,
      b.updated_at,
      case p_sort
        when 'contact' then lower(c.full_name)
        when 'owner'   then lower(p.full_name)
        when 'tags'    then (select lower(min(tg.name)) from deal_tags dt join tags tg on tg.id = dt.tag_id where dt.deal_id = b.id)
      end as k_text,
      case p_sort
        when 'stage' then s.position::numeric
      end as k_num,
      case p_sort
        when 'task' then (select min(t.due_at) from tasks t where t.deal_id = b.id and t.done_at is null and t.deleted_at is null)
        when 'created' then b.created_at
        else b.updated_at
      end as k_time
    from base b
    left join contacts c on c.id = b.contact_id
    left join profiles p on p.id = b.owner_id
    left join stages s on s.id = b.stage_id
  )
  select k.id, count(*) over () as total
  from keyed k
  order by
    case when asc_ then k.k_text end asc nulls last,
    case when not asc_ then k.k_text end desc nulls last,
    case when asc_ then k.k_num end asc nulls last,
    case when not asc_ then k.k_num end desc nulls last,
    case when asc_ then k.k_time end asc nulls last,
    case when not asc_ then k.k_time end desc nulls last,
    k.id
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 200);
end;
$function$;

grant execute on function public.crm_deals_table(text, uuid, uuid, text, text, text, integer, integer, uuid, text) to authenticated;
