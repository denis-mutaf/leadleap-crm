-- Правила видимости вызывали can_see_* и my_role() на каждую строку, а те внутри
-- ещё по нескольку раз читали profiles и settings. Замер 23.09.2026 под QA-админом:
-- счётчик пропущенных звонков в левой панели — 1473 мс (под нагрузкой ~3 с, его
-- ждёт каждая страница), crm_board — 1250 мс против 242 мс без RLS,
-- crm_task_counters — 645 мс, list_crm_trash — 339 мс.
--
-- То, что одинаково для всего запроса, завёрнуто в (select …) — Postgres считает
-- это один раз (InitPlan). Перед построчной проверкой стоит короткое замыкание
-- «видит всё и запись не удалена» — ровно то, чем для такого пользователя
-- заканчивается can_see_deal/can_see_contact, как уже сделано в contact_phones_read.
-- Для менеджера с видимостью «только свои» остаётся прежняя построчная ветка:
-- смысл правил не меняется.
--
-- Эквивалентность проверена 24.09.2026: для каждого из 15 пользователей в режимах
-- manager_visibility = all и own набор видимых строк в каждой таблице до и после
-- совпадает (count + md5 строк), в том числе на мягко удалённых сделках и контактах;
-- нарочно испорченное правило тот же тест ловит. После: пропущенные звонки 14 мс,
-- crm_board ~0,5 с, crm_task_counters 38 мс, list_crm_trash 65 мс.

ALTER POLICY audit_read ON public.audit_log
  USING (((SELECT my_role()) = ANY (ARRAY['head'::user_role, 'admin'::user_role])));

ALTER POLICY call_transcripts_read ON public.call_transcripts
  USING ((EXISTS ( SELECT 1
   FROM calls c
  WHERE ((c.id = call_transcripts.call_id) AND (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND ((SELECT sees_everything()) OR c.user_id = (SELECT auth.uid()) OR CASE WHEN c.deal_id IS NOT NULL THEN (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = c.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(c.deal_id)) WHEN c.contact_id IS NOT NULL THEN (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = c.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(c.contact_id)) ELSE false END))))));

ALTER POLICY calls_read ON public.calls
  USING ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND ((SELECT sees_everything()) OR calls.user_id = (SELECT auth.uid()) OR CASE WHEN calls.deal_id IS NOT NULL THEN (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = calls.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(calls.deal_id)) WHEN calls.contact_id IS NOT NULL THEN (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = calls.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(calls.contact_id)) ELSE false END)));

ALTER POLICY calls_write ON public.calls
  USING ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND ((SELECT sees_everything()) OR calls.user_id = (SELECT auth.uid()) OR CASE WHEN calls.deal_id IS NOT NULL THEN (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = calls.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(calls.deal_id)) WHEN calls.contact_id IS NOT NULL THEN (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = calls.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(calls.contact_id)) ELSE false END)))
  WITH CHECK (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY contact_channels_delete ON public.contact_channels
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_channels.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_channels.contact_id)));

ALTER POLICY contact_channels_insert ON public.contact_channels
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_channels.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_channels.contact_id)));

ALTER POLICY contact_channels_read ON public.contact_channels
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_channels.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_channels.contact_id)));

ALTER POLICY contact_channels_update ON public.contact_channels
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_channels.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_channels.contact_id)))
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_channels.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_channels.contact_id)));

ALTER POLICY contact_phones_delete ON public.contact_phones
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_phones.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_phones.contact_id)));

ALTER POLICY contact_phones_insert ON public.contact_phones
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_phones.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_phones.contact_id)));

ALTER POLICY contact_phones_update ON public.contact_phones
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_phones.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_phones.contact_id)))
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_phones.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_phones.contact_id)));

ALTER POLICY contact_tags_delete ON public.contact_tags
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_tags.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_tags.contact_id)));

ALTER POLICY contact_tags_insert ON public.contact_tags
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_tags.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_tags.contact_id)));

ALTER POLICY contact_tags_read ON public.contact_tags
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = contact_tags.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(contact_tags.contact_id)));

ALTER POLICY conversations_all ON public.conversations
  USING ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND CASE WHEN conversations.contact_id IS NULL THEN (conversations.assigned_to IS NULL OR conversations.assigned_to = (SELECT auth.uid()) OR (SELECT sees_everything())) ELSE (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = conversations.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(conversations.contact_id)) END))
  WITH CHECK ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND CASE WHEN conversations.contact_id IS NULL THEN (conversations.assigned_to IS NULL OR conversations.assigned_to = (SELECT auth.uid()) OR (SELECT sees_everything())) ELSE (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = conversations.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(conversations.contact_id)) END));

ALTER POLICY custom_field_defs_admin_write ON public.custom_field_defs
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY custom_field_defs_read ON public.custom_field_defs
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY custom_values_delete ON public.custom_field_values
  USING (EXISTS (SELECT 1 FROM custom_field_defs zf WHERE zf.id = custom_field_values.field_id AND ((zf.entity = 'deal' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = custom_field_values.entity_id AND zd.deleted_at IS NULL)) OR can_see_deal(custom_field_values.entity_id))) OR (zf.entity = 'contact' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = custom_field_values.entity_id AND zc.deleted_at IS NULL)) OR can_see_contact(custom_field_values.entity_id))))));

ALTER POLICY custom_values_insert ON public.custom_field_values
  WITH CHECK (EXISTS (SELECT 1 FROM custom_field_defs zf WHERE zf.id = custom_field_values.field_id AND ((zf.entity = 'deal' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = custom_field_values.entity_id AND zd.deleted_at IS NULL)) OR can_see_deal(custom_field_values.entity_id))) OR (zf.entity = 'contact' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = custom_field_values.entity_id AND zc.deleted_at IS NULL)) OR can_see_contact(custom_field_values.entity_id))))));

ALTER POLICY custom_values_read ON public.custom_field_values
  USING (EXISTS (SELECT 1 FROM custom_field_defs zf WHERE zf.id = custom_field_values.field_id AND ((zf.entity = 'deal' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = custom_field_values.entity_id AND zd.deleted_at IS NULL)) OR can_see_deal(custom_field_values.entity_id))) OR (zf.entity = 'contact' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = custom_field_values.entity_id AND zc.deleted_at IS NULL)) OR can_see_contact(custom_field_values.entity_id))))));

ALTER POLICY custom_values_update ON public.custom_field_values
  USING (EXISTS (SELECT 1 FROM custom_field_defs zf WHERE zf.id = custom_field_values.field_id AND ((zf.entity = 'deal' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = custom_field_values.entity_id AND zd.deleted_at IS NULL)) OR can_see_deal(custom_field_values.entity_id))) OR (zf.entity = 'contact' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = custom_field_values.entity_id AND zc.deleted_at IS NULL)) OR can_see_contact(custom_field_values.entity_id))))))
  WITH CHECK (EXISTS (SELECT 1 FROM custom_field_defs zf WHERE zf.id = custom_field_values.field_id AND ((zf.entity = 'deal' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = custom_field_values.entity_id AND zd.deleted_at IS NULL)) OR can_see_deal(custom_field_values.entity_id))) OR (zf.entity = 'contact' AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = custom_field_values.entity_id AND zc.deleted_at IS NULL)) OR can_see_contact(custom_field_values.entity_id))))));

ALTER POLICY deal_contacts_all ON public.deal_contacts
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = deal_contacts.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(deal_contacts.deal_id)))
  WITH CHECK (((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = deal_contacts.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(deal_contacts.deal_id)) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = deal_contacts.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(deal_contacts.contact_id))));

ALTER POLICY deal_projects_all ON public.deal_projects
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = deal_projects.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(deal_projects.deal_id)))
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = deal_projects.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(deal_projects.deal_id)));

ALTER POLICY deal_tags_all ON public.deal_tags
  WITH CHECK ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = deal_tags.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(deal_tags.deal_id)));

ALTER POLICY imported_contact_phones_read ON public.imported_contact_phones
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = imported_contact_phones.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(imported_contact_phones.contact_id)));

ALTER POLICY lost_reasons_admin_write ON public.lost_reasons
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY lost_reasons_read ON public.lost_reasons
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY messages_all ON public.messages
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND CASE WHEN c.contact_id IS NULL THEN (c.assigned_to IS NULL OR c.assigned_to = (SELECT auth.uid()) OR (SELECT sees_everything())) ELSE (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = c.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(c.contact_id)) END)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND CASE WHEN c.contact_id IS NULL THEN (c.assigned_to IS NULL OR c.assigned_to = (SELECT auth.uid()) OR (SELECT sees_everything())) ELSE (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = c.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(c.contact_id)) END)))));

ALTER POLICY notes_insert ON public.notes
  WITH CHECK (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (((deal_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = notes.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(notes.deal_id))) OR ((deal_id IS NULL) AND (contact_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = notes.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(notes.contact_id))))));

ALTER POLICY notes_read ON public.notes
  USING (((deleted_at IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (((deal_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = notes.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(notes.deal_id))) OR ((deal_id IS NULL) AND (contact_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = notes.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(notes.contact_id))))));

ALTER POLICY notes_update ON public.notes
  USING (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (((deal_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = notes.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(notes.deal_id))) OR ((deal_id IS NULL) AND (contact_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = notes.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(notes.contact_id))))))
  WITH CHECK (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (((deal_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = notes.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(notes.deal_id))) OR ((deal_id IS NULL) AND (contact_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = notes.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(notes.contact_id))))));

ALTER POLICY notification_rules_admin ON public.notification_rules
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY notification_rules_read ON public.notification_rules
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY notifications_own ON public.notifications
  USING ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (user_id = (SELECT auth.uid())) AND ((deal_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = notifications.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(notifications.deal_id))) AND ((contact_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = notifications.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(notifications.contact_id)))))
  WITH CHECK ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (user_id = (SELECT auth.uid()))));

ALTER POLICY profiles_admin_write ON public.profiles
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY profiles_read ON public.profiles
  USING ((((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) OR (id = (SELECT auth.uid()))));

ALTER POLICY projects_admin_write ON public.projects
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY projects_read ON public.projects
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY settings_admin_write ON public.settings
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY settings_read ON public.settings
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY sources_admin_write ON public.sources
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY sources_read ON public.sources
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY stage_transitions_read ON public.stage_transitions
  USING ((((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = stage_transitions.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(stage_transitions.deal_id)));

ALTER POLICY stages_admin_write ON public.stages
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY stages_read ON public.stages
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY tags_head_write ON public.tags
  USING (((SELECT my_role()) = ANY (ARRAY['head'::user_role, 'admin'::user_role])))
  WITH CHECK (((SELECT my_role()) = ANY (ARRAY['head'::user_role, 'admin'::user_role])));

ALTER POLICY tags_read ON public.tags
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY task_types_admin_write ON public.task_types
  USING (((SELECT my_role()) = 'admin'::user_role))
  WITH CHECK (((SELECT my_role()) = 'admin'::user_role));

ALTER POLICY task_types_read ON public.task_types
  USING (((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])));

ALTER POLICY tasks_insert ON public.tasks
  WITH CHECK (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND ((deal_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = tasks.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(tasks.deal_id))) AND ((contact_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = tasks.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(tasks.contact_id))) AND ((deal_id IS NOT NULL) OR ((SELECT sees_everything()) OR (assignee_id = (SELECT auth.uid()))))));

ALTER POLICY tasks_read ON public.tasks
  USING (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (((deal_id IS NULL) AND (contact_id IS NULL) AND ((SELECT sees_everything()) OR (assignee_id = (SELECT auth.uid())))) OR ((deal_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = tasks.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(tasks.deal_id)) AND ((contact_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = tasks.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(tasks.contact_id)))) OR ((deal_id IS NULL) AND (contact_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = tasks.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(tasks.contact_id)) AND ((SELECT sees_everything()) OR (assignee_id = (SELECT auth.uid())))))));

ALTER POLICY tasks_update ON public.tasks
  USING (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND (((deal_id IS NULL) AND (contact_id IS NULL) AND ((SELECT sees_everything()) OR (assignee_id = (SELECT auth.uid())))) OR ((deal_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = tasks.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(tasks.deal_id)) AND ((contact_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = tasks.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(tasks.contact_id)))) OR ((deal_id IS NULL) AND (contact_id IS NOT NULL) AND (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = tasks.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(tasks.contact_id)) AND ((SELECT sees_everything()) OR (assignee_id = (SELECT auth.uid())))))))
  WITH CHECK (((deleted_at IS NULL) AND (deleted_by IS NULL) AND ((SELECT my_role()) = ANY (ARRAY['manager'::user_role, 'head'::user_role, 'admin'::user_role])) AND ((deal_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM deals zd WHERE zd.id = tasks.deal_id AND zd.deleted_at IS NULL)) OR can_see_deal(tasks.deal_id))) AND ((contact_id IS NULL) OR (((SELECT sees_everything()) AND EXISTS (SELECT 1 FROM contacts zc WHERE zc.id = tasks.contact_id AND zc.deleted_at IS NULL)) OR can_see_contact(tasks.contact_id))) AND ((deal_id IS NOT NULL) OR ((SELECT sees_everything()) OR (assignee_id = (SELECT auth.uid()))))));
