-- Журнал звонков под RLS читался 2,97 с: политика вызывала can_see_contact на каждой
-- из 7 512 строк, планировщик брал Seq Scan и сортировал всё целиком. Замер
-- 21.09.2026: explain (analyze) — Seq Scan on calls, Execution Time 2974 ms.
--
-- Порядок проверок переставлен от дешёвой к дорогой: у head и admin всё решает
-- sees_everything(), у менеджера свои звонки отсекаются сравнением user_id,
-- и только чужой звонок доходит до обхода сделок и контактов. Тогда индекс
-- calls_started_at_idx работает, и limit 50 останавливает чтение.
create or replace function public.can_see_call(
  target_deal uuid, target_contact uuid, target_user uuid
) returns boolean language sql stable security definer
set search_path = public, pg_temp as $fn$
  select public.my_role() in ('manager', 'head', 'admin')
     and (
       public.sees_everything()
       -- Свой звонок менеджер видит всегда: он его и сделал.
       or target_user = auth.uid()
       or case
            when target_deal is not null then public.can_see_deal(target_deal)
            when target_contact is not null then public.can_see_contact(target_contact)
            else false
          end
     );
$fn$;

drop policy if exists calls_read on public.calls;
create policy calls_read on public.calls for select
  using (public.can_see_call(deal_id, contact_id, user_id));

drop policy if exists calls_write on public.calls;
create policy calls_write on public.calls for update
  using (public.can_see_call(deal_id, contact_id, user_id))
  with check (public.my_role() in ('manager', 'head', 'admin'));
