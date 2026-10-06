-- QA / тикет 57 (раздел D и B-21).
--
-- 1. Метки: «квал» при «КВАЛ» — тот же ярлык. Сейчас unique(name) различает
--    регистр, поэтому дубль в другом регистре либо проходил, либо отклонялся
--    без объяснения. Уникальность — по имени без регистра и пробелов по краям.
--    На проде совпадений по lower(name) нет (проверено SELECT), индекс встанет.
-- 2. «Последний вход» в настройках пользователей брался из
--    auth.users.last_sign_in_at: он обновляется только при вводе пароля, а
--    открытая сессия живёт неделями. Активность читаем по auth.sessions.

create unique index if not exists tags_name_lower_key
  on public.tags (lower(btrim(name)));

comment on index public.tags_name_lower_key is
  'Метка уникальна без учёта регистра и крайних пробелов («квал» = «КВАЛ»)';

-- Когда пользователь в последний раз что-то делал в CRM: самая свежая из его
-- сессий (refreshed_at двигается при каждом обновлении токена, пока вкладка
-- открыта). Зовёт только страница настроек пользователей через сервисный ключ.
create or replace function public.crm_users_last_seen()
returns table (user_id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select s.user_id,
         max(greatest(s.updated_at, coalesce(s.refreshed_at at time zone 'UTC', s.updated_at))) as last_seen_at
    from auth.sessions s
   group by s.user_id;
$$;

revoke all on function public.crm_users_last_seen() from public, anon, authenticated;
grant execute on function public.crm_users_last_seen() to service_role;
