begin;

-- The feature request board no longer splits its audience. The product is
-- refocusing on the demand side, so `category` ('owner' | 'visitor') has no
-- reader left: the filter chips, the "Who is this for?" picker, the admin
-- Audience column, and the service-layer type are all gone in the same change.
--
-- The two brand-owner seed rows go with it. They are seeds (`is_seed = true`,
-- no `submitted_by`), so deleting them removes starter content rather than
-- anyone's submission; their votes cascade through
-- `feature_request_votes.request_id`. Scoped by `is_seed` as well as title so a
-- real submission that happens to reuse one of these titles survives.
delete from public.feature_requests
 where is_seed = true
   and title in ('Generate bilingual brand stories and social copy',
                 'Show which marketing channels are working');

alter table public.feature_requests drop column category;

commit;
