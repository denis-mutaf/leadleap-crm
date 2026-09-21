-- The pipeline gate resolves these two qualification tags by exact name.
-- Renaming, hiding, merging away or deleting them would silently break moves.
create or replace function public.protect_crm_qualification_tags()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.name not in ('КВАЛ', 'неквал') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Qualification tags are required by the pipeline'
      using errcode = '22023';
  end if;

  if new.name is distinct from old.name
     or new.is_active is distinct from old.is_active
     or new.merged_into is distinct from old.merged_into then
    raise exception 'Qualification tags are required by the pipeline'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger protect_crm_qualification_tags_update
before update of name, is_active, merged_into on public.tags
for each row execute function public.protect_crm_qualification_tags();

create trigger protect_crm_qualification_tags_delete
before delete on public.tags
for each row execute function public.protect_crm_qualification_tags();
