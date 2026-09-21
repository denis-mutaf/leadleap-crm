-- Evaluate actor-wide RLS checks once per statement. The row predicate and
-- visible set are identical to the policy introduced by 027.
alter policy deals_read on public.deals using (
  (select public.my_role()) in ('manager', 'head', 'admin')
  and deleted_at is null
  and (
    (select public.sees_everything())
    or owner_id = (select auth.uid())
    or owner_id is null
  )
);
