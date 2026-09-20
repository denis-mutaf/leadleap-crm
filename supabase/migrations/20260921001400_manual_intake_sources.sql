-- Manual intake needs the two offline channels shown in the approved form.
insert into public.sources (code, name)
values ('referral', 'Знакомые'), ('walk_in', 'С улицы')
on conflict (code) do nothing;
