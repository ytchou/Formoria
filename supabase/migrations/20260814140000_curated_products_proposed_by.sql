-- Curated products (DEV-1465): where a candidate came from.
--
-- The write path admits three origins over time — hand entry now, LLM proposals
-- next (DEV-1469), owner submissions later — and the review queue has to be able
-- to sort by trust. That is a property of the row, not of the actor who last
-- touched it, so it is a column and not an audit lookup.

alter table public.curated_products
  add column proposed_by text not null default 'admin'
  check (proposed_by in ('admin', 'generated', 'owner'));

comment on column public.curated_products.proposed_by is
  'Origin of the candidate: admin (hand-entered, DEV-1465), generated (LLM proposal, DEV-1469), owner (owner-proposed, future). Existing rows backfill to admin, which is accurate — every row placed before this column was hand-entered.';
