-- «Не перезвонили» — главный сегмент журнала звонков: 694 пропущенных входящих,
-- по 265 из них обратного звонка так и не было. Считать это на лету нельзя:
-- замер 21.09.2026 показал 3 268 мс, потому что not exists под RLS перебирает
-- все исходящие целиком. Факт «перезвонили» пишется рядом со звонком.
--
-- Правило: пропущенный входящий считается закрытым, если в течение 48 часов после
-- него состоялся любой разговор с тем же номером — неважно, мы перезвонили или
-- клиент позвонил снова и на этот раз трубку сняли.
alter table public.calls
  add column if not exists called_back_at timestamptz;

comment on column public.calls.called_back_at is 'Для пропущенного входящего: когда с этим номером наконец поговорили';

-- Номера в базе лежат в разном виде: «37369454619» из АТС и «+373 69 454 619»
-- из импорта. Сравнивать можно только по цифрам.
create or replace function public.phone_digits(value text) returns text
language sql immutable parallel safe as $fn$
  select nullif(regexp_replace(coalesce(value, ''), '\D', '', 'g'), '');
$fn$;

create index if not exists calls_missed_phone_idx
  on public.calls (public.phone_digits(from_phone), started_at)
  where direction = 'in' and coalesce(duration_sec, 0) = 0;

create or replace function public.crm_close_missed_calls() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if coalesce(new.duration_sec, 0) = 0 then
    return new;
  end if;
  update public.calls m
     set called_back_at = new.started_at
   where m.direction = 'in'
     and coalesce(m.duration_sec, 0) = 0
     and m.called_back_at is null
     and m.started_at <= new.started_at
     and m.started_at > new.started_at - interval '48 hours'
     and public.phone_digits(m.from_phone) = public.phone_digits(
           case when new.direction = 'in' then new.from_phone else new.to_phone end
         );
  return new;
end;
$fn$;

drop trigger if exists calls_close_missed on public.calls;
create trigger calls_close_missed
  after insert or update of duration_sec on public.calls
  for each row execute function public.crm_close_missed_calls();

-- Разбор истории: тем же правилом закрываем всё, что уже накопилось.
update public.calls m
   set called_back_at = t.answered_at
  from (
    select m.id, min(o.started_at) as answered_at
      from public.calls m
      join public.calls o
        on coalesce(o.duration_sec, 0) > 0
       and o.started_at >= m.started_at
       and o.started_at < m.started_at + interval '48 hours'
       and public.phone_digits(case when o.direction = 'in' then o.from_phone else o.to_phone end)
           = public.phone_digits(m.from_phone)
     where m.direction = 'in' and coalesce(m.duration_sec, 0) = 0
     group by m.id
  ) t
 where m.id = t.id and m.called_back_at is distinct from t.answered_at;

create index if not exists calls_no_callback_idx on public.calls (started_at desc)
  where direction = 'in' and coalesce(duration_sec, 0) = 0 and called_back_at is null;
