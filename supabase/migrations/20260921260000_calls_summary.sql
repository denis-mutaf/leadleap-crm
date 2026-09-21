-- Точные итоги журнала звонков одним запросом. Выборка duration_sec через
-- PostgREST обрезалась max_rows и на «Всё время» показывала статистику только
-- части журнала. Функция security invoker: RLS calls/contacts сохраняется.
create or replace function public.crm_calls_summary(
  p_segment text default 'all',
  p_since timestamptz default null,
  p_user uuid default null,
  p_direction text default null,
  p_only_recording boolean default false,
  p_query text default null
) returns jsonb
language sql stable
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'total', count(*),
    'talked', count(*) filter (where coalesce(c.duration_sec, 0) > 0),
    'duration_sec', coalesce(sum(greatest(coalesce(c.duration_sec, 0), 0)), 0)
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where
    case p_segment
      when 'mine' then c.user_id = auth.uid()
      when 'missed' then c.direction = 'in' and coalesce(c.duration_sec, 0) = 0
      when 'nocallback' then c.direction = 'in' and coalesce(c.duration_sec, 0) = 0
        and c.called_back_at is null
      else true
    end
    and (p_since is null or c.started_at >= p_since)
    and (p_user is null or c.user_id = p_user)
    and (p_direction is null or c.direction::text = p_direction)
    and (
      not p_only_recording
      or c.recording_path is not null
      or nullif(c.recording_url, '') is not null
    )
    and (
      nullif(trim(p_query), '') is null
      or c.from_phone ilike '%' || p_query || '%'
      or c.to_phone ilike '%' || p_query || '%'
      or ct.full_name ilike '%' || p_query || '%'
    );
$fn$;

grant execute on function public.crm_calls_summary(text,timestamptz,uuid,text,boolean,text)
  to authenticated;
