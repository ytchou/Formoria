begin;

-- A vote now carries either an account or an anonymous browser identity, never
-- both: the board takes guest votes, and a guest has no auth.users row to
-- reference. `visitor_hash` mirrors public.brand_likes — a one-way SHA-256 of
-- the signed fm_like_visitor cookie, so no raw identifier is ever stored.
alter table public.feature_request_votes
  alter column user_id drop not null;

alter table public.feature_request_votes
  add column visitor_hash text check (visitor_hash ~ '^[0-9a-f]{64}$');

alter table public.feature_request_votes
  add constraint feature_request_votes_identity_check
  check (num_nonnulls(user_id, visitor_hash) = 1);

alter table public.feature_request_votes
  drop constraint if exists feature_request_votes_request_id_user_id_key;

-- Two partial uniques, because one dedup rule cannot span a nullable pair.
create unique index feature_request_votes_user_unique
  on public.feature_request_votes (request_id, user_id)
  where user_id is not null;

create unique index feature_request_votes_visitor_unique
  on public.feature_request_votes (request_id, visitor_hash)
  where visitor_hash is not null;

create index feature_request_votes_visitor_idx
  on public.feature_request_votes (visitor_hash);

comment on column public.feature_request_votes.visitor_hash is
  'One-way SHA-256 of the signed fm_like_visitor cookie, identifying an anonymous voter. Mutually exclusive with user_id; internal only, never exposed in the public board projection.';

comment on table public.feature_request_votes is
  'One vote per (request, identity), where an identity is an account or an anonymous visitor hash. Vote counts are aggregated server-side.';

commit;
