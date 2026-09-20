-- Manual qualification is a team judgement recorded by tags. The older
-- requires_qualification flag still controls structured-field completeness.
alter table public.stages
  add column requires_qualification_tag boolean not null default false;

create or replace function public.enforce_qualification_tag()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  source_position smallint;
  target_stage public.stages%rowtype;
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;
  select * into target_stage from public.stages where id = new.stage_id;
  select position into source_position from public.stages where id = old.stage_id;
  if target_stage.kind <> 'open' or target_stage.position <= source_position
    or not target_stage.requires_qualification_tag then
    return new;
  end if;
  if not exists (
    select 1 from public.deal_tags dt
    join public.tags t on t.id = dt.tag_id
    where dt.deal_id = new.id and t.name in ('КВАЛ', 'неквал')
  ) then
    raise exception 'Отметьте КВАЛ или неквал перед переходом'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger deals_qualification_tag_gate before update of stage_id on public.deals
  for each row execute function public.enforce_qualification_tag();

-- A single PostgREST RPC keeps the supporting tag/task and stage move in one
-- transaction. SECURITY INVOKER deliberately retains all table RLS policies.
create or replace function public.transition_crm_deal(
  p_deal_id uuid,
  p_stage_id uuid,
  p_owner_id uuid,
  p_lost_reason_id uuid,
  p_lost_comment text,
  p_qualification text,
  p_task_title text,
  p_task_due_at timestamptz,
  p_task_type_id uuid,
  p_task_assignee_id uuid
)
returns jsonb
language plpgsql volatile security invoker
set search_path = public, pg_temp
as $$
declare
  current_deal public.deals%rowtype;
  next_stage public.stages%rowtype;
  qualification_tag_id uuid;
  task_assignee uuid;
begin
  if auth.uid() is null or not coalesce(public.my_role() in ('manager', 'head', 'admin'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into current_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal unavailable' using errcode = '42501'; end if;
  select * into next_stage from public.stages where id = p_stage_id and is_active;
  if not found then raise exception 'Choose an active stage' using errcode = '22023'; end if;

  if p_owner_id is not null and not exists (
    select 1 from public.profiles
    where id = p_owner_id and is_active and role in ('manager', 'head', 'admin')
  ) then
    raise exception 'Choose an active owner' using errcode = '22023';
  end if;
  if next_stage.kind = 'lost' then
    if p_lost_reason_id is null or not exists (
      select 1 from public.lost_reasons
      where id = p_lost_reason_id and is_active
    ) then
      raise exception 'Choose a loss reason' using errcode = '22023';
    end if;
  elsif p_lost_reason_id is not null then
    raise exception 'Loss reason is only valid for refusal' using errcode = '22023';
  end if;

  if p_qualification is not null then
    if p_qualification not in ('КВАЛ', 'неквал') then
      raise exception 'Invalid qualification' using errcode = '22023';
    end if;
    select id into qualification_tag_id from public.tags
      where name = p_qualification;
    if qualification_tag_id is null then
      raise exception 'Qualification tag is missing' using errcode = '22023';
    end if;
    delete from public.deal_tags dt
    using public.tags t
    where dt.deal_id = p_deal_id and dt.tag_id = t.id
      and t.name in ('КВАЛ', 'неквал') and t.id <> qualification_tag_id;
    insert into public.deal_tags (deal_id, tag_id, created_by)
    values (p_deal_id, qualification_tag_id, auth.uid())
    on conflict (deal_id, tag_id) do nothing;
  end if;

  if p_task_title is not null or p_task_due_at is not null
    or p_task_type_id is not null or p_task_assignee_id is not null then
    if nullif(btrim(p_task_title), '') is null
      or p_task_due_at is null or p_task_due_at <= now() then
      raise exception 'Task needs a title and future date' using errcode = '22023';
    end if;
    if p_task_type_id is not null and not exists (
      select 1 from public.task_types where id = p_task_type_id and is_active
    ) then
      raise exception 'Choose an active task type' using errcode = '22023';
    end if;
    task_assignee := coalesce(p_task_assignee_id, p_owner_id, auth.uid());
    if not exists (
      select 1 from public.profiles
      where id = task_assignee and is_active and role in ('manager', 'head', 'admin')
    ) then
      raise exception 'Choose an active task assignee' using errcode = '22023';
    end if;
    insert into public.tasks (
      deal_id, contact_id, assignee_id, type_id, title, due_at, created_by
    ) values (
      p_deal_id, current_deal.contact_id, task_assignee, p_task_type_id,
      btrim(p_task_title), p_task_due_at, auth.uid()
    );
  end if;

  update public.deals
  set stage_id = p_stage_id,
      owner_id = p_owner_id,
      lost_reason_id = case when next_stage.kind = 'lost' then p_lost_reason_id else null end,
      lost_comment = case when next_stage.kind = 'lost' then nullif(btrim(p_lost_comment), '') else null end
  where id = p_deal_id
  returning * into current_deal;
  if not found then raise exception 'Deal unavailable' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', current_deal.id,
    'stage_id', current_deal.stage_id,
    'owner_id', current_deal.owner_id,
    'status', current_deal.status
  );
end;
$$;

revoke all on function public.transition_crm_deal(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, uuid, uuid
) from public, anon;
grant execute on function public.transition_crm_deal(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, uuid, uuid
) to authenticated;
