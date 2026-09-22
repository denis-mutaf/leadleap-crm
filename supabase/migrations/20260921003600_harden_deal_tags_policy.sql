-- Make the deal_tags visibility predicate planner-friendly while preserving
-- the existing deal visibility boundary from can_see_deal().
alter policy deal_tags_all on public.deal_tags
  using (
    deal_id in (select d.id from public.deals d)
  )
  with check (
    public.can_see_deal(deal_id)
  );
