-- Права режутся политиками базы, а не спрятанными кнопками:
-- менеджер не увидит чужую сделку, даже обратившись к API напрямую.

-- Триггеры пишут историю и лог от имени системы, иначе их записи упрутся в те же политики.
alter function record_stage_transition() security definer;
alter function create_touch_task() security definer;
alter function write_audit() security definer;

create or replace function my_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- Руководитель отдела и администратор видят всё.
create or replace function sees_everything()
returns boolean
language sql
stable
as $$
  select my_role() in ('head', 'admin');
$$;

create or replace function can_see_deal(target_deal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from deals d
    where d.id = target_deal
      and (sees_everything() or d.owner_id = auth.uid() or d.owner_id is null)
  );
$$;

alter table profiles            enable row level security;
alter table projects            enable row level security;
alter table stages              enable row level security;
alter table sources             enable row level security;
alter table lost_reasons        enable row level security;
alter table task_types          enable row level security;
alter table tags                enable row level security;
alter table settings            enable row level security;
alter table contacts            enable row level security;
alter table contact_phones      enable row level security;
alter table contact_channels    enable row level security;
alter table deals               enable row level security;
alter table deal_projects       enable row level security;
alter table deal_tags           enable row level security;
alter table contact_tags        enable row level security;
alter table stage_transitions   enable row level security;
alter table tasks               enable row level security;
alter table notes               enable row level security;
alter table custom_field_defs   enable row level security;
alter table custom_field_values enable row level security;
alter table inbound_events      enable row level security;
alter table calls               enable row level security;
alter table conversations       enable row level security;
alter table messages            enable row level security;
alter table notifications       enable row level security;
alter table notification_rules  enable row level security;
alter table audit_log           enable row level security;

-- Сотрудники: список виден всем своим, правит администратор.
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_admin_write on profiles for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Справочники: читают все, правит администратор.
do $$
declare t text;
begin
  foreach t in array array['projects', 'stages', 'sources', 'lost_reasons', 'task_types', 'settings', 'custom_field_defs']
  loop
    execute format('create policy %I_read on %I for select to authenticated using (true)', t, t);
    execute format(
      'create policy %I_admin_write on %I for all to authenticated using (my_role() = ''admin'') with check (my_role() = ''admin'')',
      t, t);
  end loop;
end
$$;

-- Теги: читают все, заводит руководитель. Свободного ввода у менеджера нет.
create policy tags_read on tags for select to authenticated using (true);
create policy tags_head_write on tags for all to authenticated
  using (my_role() in ('head', 'admin')) with check (my_role() in ('head', 'admin'));

-- Сделки: своё и общий котёл. Застройщику карточки закрыты.
create policy deals_read on deals for select to authenticated
  using (sees_everything() or owner_id = auth.uid() or owner_id is null);
create policy deals_insert on deals for insert to authenticated
  with check (my_role() in ('manager', 'head', 'admin'));
create policy deals_update on deals for update to authenticated
  using (sees_everything() or owner_id = auth.uid() or owner_id is null)
  with check (sees_everything() or owner_id = auth.uid() or owner_id is null);
create policy deals_delete on deals for delete to authenticated
  using (sees_everything());

-- Контакт виден, если виден хотя бы один его разговор с отделом.
create policy contacts_read on contacts for select to authenticated
  using (
    sees_everything() or exists (
      select 1 from deals d
      where d.contact_id = contacts.id
        and (d.owner_id = auth.uid() or d.owner_id is null)
    )
  );
create policy contacts_write on contacts for all to authenticated
  using (my_role() in ('manager', 'head', 'admin'))
  with check (my_role() in ('manager', 'head', 'admin'));

create policy contact_phones_all on contact_phones for all to authenticated
  using (my_role() <> 'builder') with check (my_role() <> 'builder');
create policy contact_channels_all on contact_channels for all to authenticated
  using (my_role() <> 'builder') with check (my_role() <> 'builder');
create policy contact_tags_all on contact_tags for all to authenticated
  using (my_role() <> 'builder') with check (my_role() <> 'builder');

-- Всё, что висит на сделке, наследует её видимость.
create policy deal_projects_all on deal_projects for all to authenticated
  using (can_see_deal(deal_id)) with check (can_see_deal(deal_id));
create policy deal_tags_all on deal_tags for all to authenticated
  using (can_see_deal(deal_id)) with check (can_see_deal(deal_id));
create policy stage_transitions_read on stage_transitions for select to authenticated
  using (can_see_deal(deal_id));
create policy notes_all on notes for all to authenticated
  using (deal_id is null or can_see_deal(deal_id))
  with check (deal_id is null or can_see_deal(deal_id));
create policy calls_read on calls for select to authenticated
  using (sees_everything() or deal_id is null or can_see_deal(deal_id));
create policy calls_write on calls for update to authenticated
  using (sees_everything() or deal_id is null or can_see_deal(deal_id))
  with check (my_role() <> 'builder');

-- Задачи: свои и по своим сделкам.
create policy tasks_read on tasks for select to authenticated
  using (sees_everything() or assignee_id = auth.uid() or (deal_id is not null and can_see_deal(deal_id)));
create policy tasks_write on tasks for all to authenticated
  using (sees_everything() or assignee_id = auth.uid() or (deal_id is not null and can_see_deal(deal_id)))
  with check (my_role() <> 'builder');

-- Переписка: единый инбокс, закрыт от застройщика.
create policy conversations_all on conversations for all to authenticated
  using (my_role() <> 'builder') with check (my_role() <> 'builder');
create policy messages_all on messages for all to authenticated
  using (my_role() <> 'builder') with check (my_role() <> 'builder');

-- Значения пользовательских полей идут вместе с карточкой.
create policy custom_values_all on custom_field_values for all to authenticated
  using (my_role() <> 'builder') with check (my_role() <> 'builder');

-- Уведомления строго свои.
create policy notifications_own on notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_rules_read on notification_rules for select to authenticated using (true);
create policy notification_rules_admin on notification_rules for all to authenticated
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- Лог изменений читают руководитель и администратор.
create policy audit_read on audit_log for select to authenticated using (sees_everything());

-- inbound_events политик не имеет: сырые события пишет только сервер по service_role,
-- сотрудникам они не нужны и видны быть не должны.
