-- Окно входящего звонка опрашивало notifications каждые 1,2 с из каждой вкладки.
-- Теперь оно подписано на изменения своих строк через Realtime, а опрос раз в 15 с
-- остался страховкой. Строк ~10 в сутки, RLS notifications_own уже в InitPlan.
alter publication supabase_realtime add table public.notifications;
