-- A retried INCOMING webhook may overlap its first attempt. Keep one call
-- card per recipient even if both requests pass the application lookup.
create unique index notifications_pbx_call_recipient_idx
on public.notifications (user_id, kind, ((payload ->> 'callid')))
where kind in ('incoming_call', 'new_lead') and payload ? 'callid';
