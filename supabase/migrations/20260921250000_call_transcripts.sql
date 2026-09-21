-- Расшифровка записи звонка хранится отдельно от журнала: список звонков не
-- должен таскать тяжёлый текст. Один звонок — одна актуальная расшифровка;
-- повторный запуск обновляет её и не создаёт дубль.
create table if not exists public.call_transcripts (
  call_id uuid primary key references public.calls(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  transcript text,
  language text,
  segments jsonb not null default '[]'::jsonb,
  model text,
  usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.call_transcripts is
  'Batch-STT для записей звонков; аудио отправляется в OpenRouter только с сервера';

alter table public.call_transcripts enable row level security;

drop policy if exists call_transcripts_read on public.call_transcripts;
create policy call_transcripts_read on public.call_transcripts for select
  using (
    exists (
      select 1
      from public.calls c
      where c.id = call_transcripts.call_id
        and public.can_see_call(c.deal_id, c.contact_id, c.user_id)
    )
  );

-- Запись выполняет сервер service_role. Пользовательский клиент может только
-- читать результат через RLS; ключ OpenRouter и служебные ошибки наружу не идут.
revoke insert, update, delete on public.call_transcripts from authenticated;
grant select on public.call_transcripts to authenticated;

create index if not exists call_transcripts_status_idx
  on public.call_transcripts (status, updated_at desc);
