-- A self-update policy on the whole row lets a manager promote their own role.
-- Profile edits are administrative until a column-scoped self-service RPC exists.
drop policy if exists profiles_self_update on public.profiles;
