# Контракт корзины: фактический охват и безопасные границы

Статус: foundation реализован в migration 027, а typed soft-delete/restore RPC и
active-contact link guards — в migration 028; миграции не применялись. UI и purge
по-прежнему не реализованы.

Важно: RLS гарантирует active-only доступ только для клиентов, которые проходят
через PostgreSQL RLS. Service-role/admin client Supabase RLS обходит; все его
обычные чтения (webhooks, отчёты, фоновые процессы и будущий purge) обязаны явно
добавлять `deleted_at is null` либо использовать отдельный явно названный trash
контракт. Migration 027 намеренно не меняет app service-role queries.

## Фактический охват

На 21.09.2026 в схеме нет `deleted_at`, `deleted_by`, retention-метаданных или RPC
для удаления/восстановления. Найдено:

- `contacts`, `deals`, `tasks`, `notes` создаются в
  `supabase/migrations/20260920180100_contacts_and_deals.sql`.
- `calls` создаются в `supabase/migrations/20260920180300_channels.sql`.
- `stage_transitions` — история этапов; она ссылается на `deals` с `on delete cascade`.
- `deal_contacts`, `contact_phones`, `contact_channels`, `contact_emails`,
  `imported_contact_phones`, `contact_tags`, `deal_projects`, `deal_tags` —
  дополнительные связанные таблицы, появившиеся в следующих миграциях.
- `audit_log` уже есть, но текущая функция `write_audit()` пишет обычные DML-события;
  отдельного контракта для soft-delete/restore/purge нет.

### Все обнаруженные места чтения/связей

Прямые app-query по целевым таблицам есть в:

- сделки: `src/app/(app)/deals/page.tsx`, `deals/table/page.tsx`,
  `deals/[id]/page.tsx`, `settings/page.tsx`, `settings/users/page.tsx`,
  `settings/fields/page.tsx`, `global-search.tsx`, `inbox/page.tsx`,
  `reports/page.tsx`, `reports/builder-data.ts`, `incoming-call-overlay.tsx`,
  `api/webhooks/pbx/route.ts`;
- контакты: `contacts/page.tsx`, `contacts/[id]/page.tsx`, `deals/page.tsx`,
  `deals/table/page.tsx`, `deals/[id]/page.tsx`, `tasks/page.tsx`, `inbox/page.tsx`,
  `global-search.tsx`, `settings/fields/page.tsx`, `incoming-call-overlay.tsx`,
  `api/webhooks/pbx/route.ts`;
- notes/tasks/calls: `deals/[id]/page.tsx`, `contacts/[id]/page.tsx`,
  `tasks/page.tsx`, `tasks/task-completion.tsx`, `deals/[id]/record-client.tsx`,
  `incoming-call-overlay.tsx`, `global-search.tsx`, `deals/page.tsx`,
  `deals/table/page.tsx`, `api/webhooks/pbx/route.ts`;
- история этапов: `deals/[id]/page.tsx`, `reports/builder-data.ts`.

В текущем приложении нет фильтрации `deleted_at`: поиск по репозиторию не нашёл ни
одного такого поля. Значит, одного добавления колонок и RLS недостаточно для
подтверждения требования «обычные списки и ссылки не возвращают удалённое».

## Текущий RLS и опасные места

- `deals_read` и `contacts_read` определяют доступ по владельцу/связям, но не по
  удалённости. `can_see_deal()` и `can_see_contact()` также не учитывают её.
- В `20260921001200_harden_crm_rls.sql` физический `DELETE` для deals/contacts/
  notes/tasks разрешён только `head/admin`, но это не является soft-delete.
- Дочерние FK используют `on delete cascade` для телефонов, каналов, тегов,
  проектов, tasks, notes и stage_transitions. RPC удаления не должен делать
  физический `DELETE`; иначе требование сохранения notes/tasks/calls/history
  нарушается.
- `calls` и `tasks` имеют собственные политики видимости; они не автоматически
  исчезнут при скрытии родительской сделки, если не усилить их условия.
- Менеджер сейчас может видеть свои сделки и общий котёл. Для корзины требуется
  отдельное правило: менеджер видит только строки, где `deleted_by = auth.uid()`;
  это нельзя безопасно получить одной permissive-политикой поверх текущих условий.
- `audit_log` читается только `head/admin`; запись через definer-триггер уже
  существует, но actor должен быть зафиксирован до изменения, а не принят из
  пользовательского payload.

## Целевой проверяемый контракт

Следующая migration (027 по принятой нумерации проекта) должна атомарно определить:

1. На `deals`, `contacts`, `notes`, `tasks` добавить nullable `deleted_at timestamptz`
   и nullable `deleted_by uuid references profiles(id)`. Для deal сохранить
   исходные `stage_id` и `status` без переноса в новую стадию; restore только
   обнуляет delete-поля после всех проверок.
2. Добавить индексы для активных строк и корзины (`deleted_at is null` и
   `deleted_at is not null`), не меняя физические FK и не каскадя soft-delete.
3. Разделить базовые предикаты на `can_see_active_*` и `can_see_trash_*`:
   `head/admin` видят всё в корзине; `manager` видит только удалённое им. Все
   предикаты должны быть `security definer`, с фиксированным `search_path`,
   проверкой роли и fail-closed при отсутствии профиля/роли.
4. Обычные SELECT-политики и relation-предикаты должны требовать активность
   родительской записи. Это включает deals, contacts, tasks, notes, calls,
   stage_transitions и связанные contact/deal relation tables. История и
   связанные записи физически сохраняются, но не показываются через активную
   карточку.
5. Ввести отдельные RPC `delete_deal`, `restore_deal`, `delete_contact`,
   `restore_contact` (или эквивалентный строго типизированный API):
   - `SECURITY DEFINER`, `SET search_path`, без динамического SQL;
   - проверяют `auth.uid()` и роль внутри функции;
   - manager может удалить только видимую активную запись и не может удалить
     скрытую/чужую; повторное удаление и restore неактивной записи должны
     завершаться ошибкой;
   - contact delete блокируется, если существует хотя бы одна активная deal, и
     возвращает стабильный объяснимый SQLSTATE/message;
   - deal/contact delete обновляет только delete-поля и в одной транзакции пишет
     audit action с entity, entity_id, actor, timestamp и прежними значениями;
   - restore требует, чтобы запись не истекла (30 суток), проверяет доступ к
     корзине и пишет отдельный audit action.
6. Отдельная service-only функция purge истекающих записей (`deleted_at <= now()-
   interval '30 days'`) должна быть создана отдельно от RPC пользователя,
   принимать только service-role execution context, сначала удалять/архивировать
   зависимые данные по явному порядку и писать audit. На этой задаче её не
   запускать. До реализации нужно отдельно решить юридическое/операционное
   правило purge для контакта с несколькими сделками и импортных связей.
7. Прямой `DELETE` authenticated для deals/contacts должен быть отозван или
   оставлен fail-closed; наличие старого delete policy не должно обходить RPC.
   Также нужно запретить пользовательское обновление `deleted_at/deleted_by`.

## Почему migration 027 сейчас небезопасна

Без одновременного изменения app queries и всех RLS-предикатов нельзя доказать
отсутствие удалённых данных в списках, ссылках, поиске, отчётах, задачах,
входящем звонке и PBX/webhook-пути. Простое добавление колонок/RPC создаст
частично работающую корзину: удалённые строки будут видны обычным SELECT либо
останутся доступны через дочерние запросы. Простое изменение RLS без app-query
фильтров также не покрывает service/admin client и отчётные запросы.

Отдельно требуется тест-матрица под authenticated manager/head/admin и service role:
active read, trash read, чужой manager trash, hidden delete, active-contact delete,
restore stage/status, expired restore, audit и отсутствие физического каскада.

## Не выполнено намеренно

- SQL migration 027 создана как foundation: колонки, индексы, active-only RLS и
  запрет authenticated physical DELETE/direct update delete-columns.
- RPC и purge function не созданы.
- Migration 028 добавляет только `soft_delete_crm_record` и `restore_crm_record`;
  purge function намеренно не создана. Migration 028 также блокирует новые или
  восстановленные active-связи с trashed contacts на `deals` и `deal_contacts`.
- SQL syntax check в `BEGIN/ROLLBACK`, live writes, `supabase db push`, apply
  миграций и UI не выполнялись.
