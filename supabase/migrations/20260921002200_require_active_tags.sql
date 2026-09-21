-- A hidden or merged tag remains in history but cannot be attached again.
create or replace function public.require_active_crm_tag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tags where id = new.tag_id and is_active
  ) then
    raise exception 'Tag is not active' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger deal_tags_require_active
  before insert or update of tag_id on public.deal_tags
  for each row execute function public.require_active_crm_tag();

create trigger contact_tags_require_active
  before insert or update of tag_id on public.contact_tags
  for each row execute function public.require_active_crm_tag();
