-- Bounded contact lookup used by manual merge and the contacts search.
-- The partial trigram index makes ILIKE '%term%' candidate filtering index-backed
-- while excluding already merged cards. RLS remains the authority: authenticated
-- callers still receive only rows allowed by contacts policies; this index does
-- not expose data or use service-role access.
create extension if not exists pg_trgm;

create index contacts_active_full_name_trgm_idx
  on public.contacts using gin (full_name gin_trgm_ops)
  where merged_into is null;

comment on index public.contacts_active_full_name_trgm_idx is
  'Supports bounded RLS-protected ILIKE name lookup for contact merge/search; callers must keep an explicit LIMIT.';
