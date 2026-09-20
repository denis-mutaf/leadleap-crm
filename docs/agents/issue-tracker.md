# Issue tracker: Local Markdown

Задачи и карты этого репозитория живут файлами в `.scratch/`.

## Соглашения

- Одна тема — одна папка: `.scratch/<effort>/`
- Карта: `.scratch/<effort>/map.md`
- Тикет: `.scratch/<effort>/issues/NN-<slug>.md`, нумерация с `01`
- `Type:` — `research` / `prototype` / `grilling` / `task`
- `Status:` — `open` / `claimed` / `resolved` / `out-of-scope`
- `Blocked by: NN, NN` — блокировки; тикет разблокирован, когда все перечисленные `resolved`
- `Audience:` — `client` (вопрос заказчику) / `owner` (решение владельца) / `afk` (агент сам)
- Ответ дописывается в конец под `## Answer`

## Wayfinding operations

- **Frontier**: открытые, разблокированные, незаявленные файлы в `issues/`, по возрастанию номера.
- **Claim**: `Status: claimed` до начала работы.
- **Resolve**: `## Answer` + `Status: resolved` + строка в `## Decisions so far` карты.

## Доска

Проекция карты — FigJam, секция «Застройщик · уход с AmoCRM».
Рисует скилл `wayfinder-board`. Заказчик доску видит: формулировки узлов — на его языке.
