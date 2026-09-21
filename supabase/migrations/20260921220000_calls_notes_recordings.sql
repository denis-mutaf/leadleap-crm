-- Экран «Звонки»: заметка менеджера по разговору и собственное хранилище записей.
--
-- Записи разговоров лежат у Moldcell и живут ~90 дней: проверка 21.09.2026 показала,
-- что mp3 старше 23.06.2026 отдают 404. Из 7 509 ссылок играбельны 1 889, остальные
-- 5 620 потеряны безвозвратно. Дальше копируем каждую запись к себе в Storage сразу
-- после звонка, иначе теряем по дню разговоров в день.
alter table public.calls
  add column if not exists note text,
  add column if not exists note_by uuid references public.profiles(id) on delete set null,
  add column if not exists note_at timestamptz,
  add column if not exists recording_path text,
  add column if not exists recording_stored_at timestamptz,
  add column if not exists recording_gone_at timestamptz;

comment on column public.calls.recording_path is 'Путь в бакете call-recordings; null — своей копии ещё нет';
comment on column public.calls.recording_gone_at is 'Когда убедились, что Moldcell уже стёр запись: не дёргать её повторно';

-- Журнал листается по времени в обе стороны и режется по сотруднику.
create index if not exists calls_started_at_idx on public.calls (started_at desc);
create index if not exists calls_user_started_idx on public.calls (user_id, started_at desc);
-- Пропущенные входящие — главный сегмент экрана, их 694 из 7 512.
create index if not exists calls_missed_idx on public.calls (started_at desc)
  where direction = 'in' and coalesce(duration_sec, 0) = 0;
-- Очередь копирования: только то, что ещё не скопировано и не признано стёртым.
create index if not exists calls_to_store_idx on public.calls (started_at desc)
  where recording_url is not null and recording_path is null and recording_gone_at is null;

-- Приватный бакет: ссылку на запись выдаёт сервер после проверки прав на звонок.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-recordings', 'call-recordings', false, 52428800, array['audio/mpeg'])
on conflict (id) do nothing;
