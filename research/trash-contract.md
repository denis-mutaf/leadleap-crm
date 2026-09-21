# Контракт корзины: фактическое состояние

## Статус

Миграции 027–033 применены live root:

- 027 — soft-delete foundation, active-only RLS, запрет authenticated physical
  DELETE и прямого изменения delete-полей;
- 028 — typed soft-delete/restore RPC и guards для active-связей с контактами;
- 031 — `crm_report_snapshot()` для отчётов;
- 032 — `list_crm_trash()` для списка корзины.

Trash UI интегрирован. UI удаления сделки находится в работе. UI не должен
обещать автоматическое окончательное удаление сделок, контактов или задач:
автоматического purge этих типов нет.

Migration 033 содержит только notes-only service-role purge. Она применена live
после успешного `pnpm supabase db push`, но purge ещё не запускался и scheduler
не настроен.

## Действующий backend-контракт

На `deals`, `contacts`, `notes`, `tasks` используются `deleted_at` и `deleted_by`.
Обычные authenticated queries получают только active rows через RLS и связанные
предикаты. Soft-delete/restore выполняются только через typed RPC:

- `soft_delete_crm_record(text, uuid)`;
- `restore_crm_record(text, uuid)`.

RPC проверяют active profile и роль `manager/head/admin`, сохраняют связанные
notes/tasks/calls/history, не делают физического каскадного удаления и пишут
явные audit actions. Restore ограничен 30 днями. Удаление контакта блокируется
при активной сделке через прямой `deals.contact_id` или `deal_contacts`.

`list_crm_trash()` возвращает `{total, rows}` с bounded pagination. Head/admin
видят всю корзину, manager — только записи, удалённые им самим.

## Ограничения и зависимости

- Service-role/admin client обходит RLS; его active reads должны явно фильтровать
  `deleted_at is null`, а trash reads — использовать отдельный trash contract.
- Shared contacts остаются ограничением: контакт нельзя удалить, пока существует
  активная прямая или imported/shared deal-связь. Восстановление deal блокируется,
  если его direct contact или контакт из `deal_contacts` всё ещё в корзине.
- Deals и contacts не имеют автоматического purge. Удаление contact/deal из UI
  не должно показывать обещание «после 30 дней удалится автоматически».
- Tasks не имеют автоматического purge. В их существующем audit trigger есть
  сериализация строки, поэтому task purge не входит в безопасный 033 scope.
- История этапов и связанные records сохраняются при soft-delete.

## Migration 033: фактический scope

`purge_crm_trash('notes', p_limit)` — service-role-only, bounded batch `1..100`,
строгий retention cutoff `deleted_at <= now() - 30 days`, `FOR UPDATE SKIP LOCKED`,
стабильная сортировка и idempotent повторный запуск. Перед физическим удалением
пишется audit без PII.

Другие entity values намеренно отклоняются fail-closed:

- `deals` — non-cascade `calls` и дополнительные зависимости требуют отдельного
  доказательства порядка удаления;
- `contacts` — non-cascade `calls`/`conversations`, imported phones, emails и
  shared relations;
- `tasks` — существующий DELETE audit trigger пишет содержимое строки.

Миграция 033 применена, но purge не запускался и не запланирован. UI не должен
скрывать это ограничение.

## Безопасность

RLS active visibility не является защитой от service-role bypass. Все RPC имеют
фиксированный `search_path`, явные role/auth checks, ограниченные entity branches
и не используют dynamic SQL. Ошибки не содержат PII.
