# Deployment readiness: Next.js 16 + Supabase SSR Auth + Vercel webhooks

Дата проверки: 2026-09-20. Объём: официальная документация Vercel, Supabase и Next.js; локальная сверка `package.json`, `src/proxy.ts`, `src/app/login/page.tsx`, `src/app/api/webhooks/pbx/route.ts`, `src/app/api/webhooks/web-form/route.ts`. `.env.local` и значения секретов не читались. Изменений в код и внешние сервисы не вносилось.

## 1. Подтверждённые факты из первичных источников

### Vercel: создание, привязка и деплой из CLI

- `vercel link` привязывает текущий каталог к существующему проекту; если проекта нет, CLI предлагает создать его. `vercel link --yes` пропускает вопросы и использует текущий scope, каталог и имя проекта по умолчанию. Для непрерывной интеграции можно указать `--project <name-or-id>` или `VERCEL_PROJECT_ID`; приоритет у флага, затем переменной, затем `.vercel/project.json`. Источники: [Vercel CLI: link](https://vercel.com/docs/cli/link), [Vercel CLI global options](https://vercel.com/docs/cli/global-options), обращение 2026-09-20.
- При создании проекта CLI автоматически определяет Next.js и предлагает стандартные Build Command (`next build` или команда из `package.json`), output directory и development command. Источник: [Linking Projects with Vercel CLI](https://vercel.com/docs/cli/project-linking), обращение 2026-09-20.
- `vercel deploy` создаёт Preview deployment, `vercel deploy --prod` — Production deployment и направляет production-домен на него. Для проверки предусмотрены `vercel curl / --deployment <url>` и `vercel logs`; stdout команды deploy содержит URL deployment. Источники: [Deploying a project from the CLI](https://vercel.com/docs/projects/deploy-from-cli), [Deploying from source](https://vercel.com/docs/cli/deploying-from-cli), обращение 2026-09-20.

### Production environment variables

- Переменная, отмеченная для Production, применяется к следующему production deployment; production deployment можно создать push в production branch или `vercel --prod`. Preview и Development — отдельные среды. Источники: [Vercel environment variables](https://vercel.com/docs/environment-variables), [Vercel environments](https://vercel.com/docs/deployments/environments), обращение 2026-09-20.
- Безопасный operational-подход для этого проекта: задавать production secrets через Vercel CLI/dashboard с target `production`, не печатать их в shell-историю/логи и не переносить через `.env.local`. В документации Vercel для CLI есть `vercel env add <name> production` и `vercel env ls`; `vercel env pull` записывает значения в файл, поэтому его не следует использовать в рамках этой проверки. Источник: [Vercel CLI: env](https://vercel.com/docs/cli/env), обращение 2026-09-20.
- Публичные переменные с префиксом `NEXT_PUBLIC_` в Next.js предназначены для клиентского bundle; секрет service-role key и webhook tokens должны оставаться server-only. Локальный код использует service-role key только на сервере, но это требует не задавать его с `NEXT_PUBLIC_`. Источник о средах Vercel: [Environment variables](https://vercel.com/docs/environment-variables), обращение 2026-09-20; вывод о данном проекте — из локального кода.

### Supabase Auth URL/redirect configuration

- В Supabase Auth → URL Configuration production `Site URL` должен быть каноническим production URL приложения (`https://...`). Он используется как default redirect, когда код не передал `redirectTo`, и важен для email confirmation/password reset. Redirect URLs должны содержать только разрешённые URL; для локальной разработки и Vercel previews Supabase документирует `http://localhost:3000/**` и `https://*-<team-or-account-slug>.vercel.app/**`. Источник: [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), обращение 2026-09-20.
- Для production лучше использовать стабильный custom domain как Site URL; preview wildcard добавлять только если preview Auth flows действительно нужны. Supabase также рекомендует production `NEXT_PUBLIC_SITE_URL`; в текущем login page password sign-in не передаёт `redirectTo`, поэтому Site URL особенно важен для будущих email/OAuth flows. Источник: [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), обращение 2026-09-20; второе утверждение — локальное наблюдение + вывод.

### SSR Auth, Next.js 16 Proxy и Route Handlers

- Supabase SSR хранит сессию в cookies. Для Next.js Server Components нужен Proxy, который обновляет Auth token и записывает cookies; Supabase отдельно указывает, что начиная с Next.js 16 файл называется `proxy.ts` вместо `middleware.ts`. Для защиты страниц документация рекомендует проверять claims/user на сервере и не считать client session доверенной. Источники: [Supabase: creating a client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm&queryGroups=framework&queryGroups=package-manager), [Supabase Next.js tutorial](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs), обращение 2026-09-20.
- Next.js 16 допускает `proxy.ts` в `src`, named export `proxy` и статический `config.matcher`; Proxy выполняется до filesystem routes. Proxy не предназначен для медленных data fetches и не заменяет authorization checks внутри server functions. Источник: [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), обращение 2026-09-20.
- Route Handlers в App Router принимают Web `Request`/`NextRequest`, поддерживают POST и могут явно выбрать `runtime = 'nodejs'`; Node.js является default runtime. Источник: [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers), обращение 2026-09-20.

## 2. Сверка с локальным проектом

- `package.json`: Next `16.3.5`, React `19.2.8`, `@supabase/ssr`, `@supabase/supabase-js`; package manager — pnpm 10.14.0. Это соответствует требуемой Next.js 16 naming convention для `proxy.ts`.
- `src/proxy.ts`: экспортирует `proxy`; вызывает `updateSession(request)`, затем `supabase.auth.getUser()`, редиректит неавторизованных на `/login`, авторизованных с `/login` на `/deals`. Внутри функции создаётся второй Supabase client. Проверка `src/lib/supabase/middleware.ts` показала, что `updateSession` устанавливает обновлённые cookies в ответ; обнаруженная потеря этих cookies при редиректах исправлена в `src/proxy.ts`.
- В `src/proxy.ts` webhook пути пропускаются до SSR auth: `pathname.startsWith('/api/webhooks/')`. Matcher также исключает `_next`/asset paths. Это соответствует требованию не отправлять внешние webhook requests на login redirect.
- `src/app/login/page.tsx`: browser client вызывает `signInWithPassword`, после успеха делает `router.push('/deals')` и `router.refresh()`. Redirect URL Supabase для этого password login не задаётся; Site URL не участвует в обычном успешном sign-in, но остаётся критичным для email confirmation/password reset.
- PBX route: `POST /api/webhooks/pbx`, `dynamic = 'force-dynamic'`; принимает form-urlencoded, JSON и fallback text; проверяет `body.crm_token` против server-only `PBX_CRM_TOKEN`; использует service-role key для Supabase. Это подходящий Node/server route pattern, но публичный endpoint должен быть доступен Moldcell/АТС без Auth cookie.
- Web form route: `POST /api/webhooks/web-form`, `runtime = 'nodejs'`; проверяет header `x-form-token` против server-only `WEB_FORM_TOKEN`; принимает JSON и form-urlencoded; на внутренних ошибках намеренно возвращает HTTP 200. Это снижает риск повторных отправок со стороны формы, но может скрывать production failure от отправителя; расследование должно идти по Vercel logs и `inbound_events`.

## 3. Проверка production deployment

Рекомендуемая последовательность для уже разрешённого владельцем деплоя:

1. Выполнить `vercel link` в корне проекта (или `vercel link --yes --project <project>`), не коммитя `.vercel` без необходимости.
2. Задать для Production ровно нужные имена переменных, не выводя значения: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PBX_CRM_TOKEN`, `WEB_FORM_TOKEN`; отдельно подтвердить фактические имена в используемых `src/lib` файлах.
3. Выполнить Preview deployment, проверить страницу `/login` и затем `vercel curl`/логи. После проверки — `vercel deploy --prod`.
4. Проверить production URL: `GET /login` должен вернуть страницу; без Auth cookie защищённый route должен редиректить на `/login`; webhook endpoints должны не редиректить на login и должны возвращать 401 без корректного token header/body.
5. Отправить тестовый безопасный webhook с тестовыми данными и корректным токеном, затем проверить Vercel logs и ожидаемую запись в Supabase. Не подставлять реальные секреты в команды или отчёт.

## 4. Ограничения Vercel, способные мешать Moldcell и формам

- Размер request body/response body Vercel Function ограничен 4.5 MB; превышение даёт HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE`. Для текущих payloads PBX/form это, вероятно, не проблема, но multipart-файлы или большие поля формы могут её создать. Источник: [Vercel Functions limitations](https://vercel.com/docs/functions/limitations), обращение 2026-09-20.
- Ограничение времени зависит от режима/плана: для старых конфигураций Node functions документация указывает Hobby default 10 s и max 60 s, Pro default 15 s и max 300 s; при Fluid Compute значения иные. Текущие webhook handlers синхронно выполняют несколько Supabase queries/inserts до ответа, поэтому задержки Supabase или cold start могут привести к timeout и повторной доставке от Moldcell/формы. Источник: [Vercel Functions limitations](https://vercel.com/docs/functions/limitations), обращение 2026-09-20.
- Vercel не гарантирует конкретный исходящий IP для обычной serverless function в базовой конфигурации; если Moldcell требует allowlist IP, это отдельный инфраструктурный риск и требует проверки актуального Vercel продукта/тарифа или промежуточного ingress. В данном исследовании официальная найденная документация Vercel не подтверждает фиксированный IP для этого проекта — считать это неподтверждённым до проверки у провайдера.
- Webhook sender должен обращаться к стабильному HTTPS production domain, а не к Preview URL. Vercel Production deployment обновляет production domain, тогда как Preview URL меняется по deployment. Источник: [Vercel environments](https://vercel.com/docs/deployments/environments), обращение 2026-09-20.
- Риск совместимости формы: текущий `/api/webhooks/web-form` принимает JSON и `application/x-www-form-urlencoded`, но не multipart/form-data; если форма Moldcell/сайта отправляет multipart, текущий fallback может разобрать тело некорректно. Это вывод из локального route code, не ограничение Vercel.
- Риск протокола PBX: route ожидает POST и конкретные поля (`crm_token`, `cmd`, а для event — `phone`, `user`, `callid`, `direction`, `type`). Если Moldcell отправляет GET, другой content type, другой header/token placement или требует non-2xx retry semantics, deployment сам это не исправит. Это вывод из локального route code.

## 5. Итоговая оценка

**Готово с оговорками:** структура совместима с Next.js 16 App Router, Supabase SSR cookies и Vercel Node.js Route Handlers; webhook paths исключены из auth Proxy и имеют application-level token checks. До production нужно подтвердить реальные production env names/targets без раскрытия значений, настроить Supabase Site URL и redirect allowlist, выполнить Preview → production smoke test и согласовать с Moldcell метод, формат, timeout/retry и возможный IP allowlist.

## Источники

- [Vercel: Deploying a project from the CLI](https://vercel.com/docs/projects/deploy-from-cli)
- [Vercel CLI: link](https://vercel.com/docs/cli/link)
- [Vercel CLI global options](https://vercel.com/docs/cli/global-options)
- [Vercel: environment variables](https://vercel.com/docs/environment-variables)
- [Vercel: environments](https://vercel.com/docs/deployments/environments)
- [Vercel Functions limitations](https://vercel.com/docs/functions/limitations)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: creating a client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm&queryGroups=framework&queryGroups=package-manager)
- [Supabase: Next.js tutorial](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)
- [Next.js: Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Next.js: Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
