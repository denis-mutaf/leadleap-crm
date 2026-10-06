-- «Отложить до…», правка к 20261007100000_postpone.sql.
-- Переход по этапу снимает только статус и postponed_until, а задача касания
-- остаётся будущим шагом: иначе гейт requires_next_step засчитывает её при
-- переходе и тут же теряет, и сделка остаётся без следующего шага.
-- Задачу касания закрывает только кнопка «Вернуть в работу» (resume_crm_deal),
-- она помечает транзакцию crm.postpone_resume. Отказ закрывает задачи в модалке.

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

  -- «Вернуть в работу» (resume_crm_deal): задача касания больше не нужна.
  -- Переход по этапу и автовозврат её не закрывают.
  if old.status = 'postponed'
     and new.status is distinct from 'postponed'
     and coalesce(current_setting('crm.postpone_resume', true), '') = 'on'
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
    perform set_config('crm.postpone_resume', 'on', true);
    update public.deals set status = 'open', postponed_until = null where id = p_deal_id;
    perform set_config('crm.postpone_resume', 'off', true);
  end if;

  return jsonb_build_object('status', case when v_deal.status = 'postponed' then 'open' else v_deal.status::text end,
                            'postponed_until', null);
end;
$$;

revoke all on function public.resume_crm_deal(uuid) from public, anon;
grant execute on function public.resume_crm_deal(uuid) to authenticated, service_role;
