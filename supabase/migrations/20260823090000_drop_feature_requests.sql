-- Retire the feature request board.
--
-- The public board at /feature-requests, its admin queue, its server actions and
-- its service layer are all deleted in the same change; nothing in the codebase
-- reads or writes these two tables any more. The route and its legacy /feedback
-- alias now 404 by design — both stay in RESERVED_ROUTES (src/proxy.ts) so a
-- bare hit is not redirected into /brands/<segment>.
--
-- The rows are destroyed DELIBERATELY. Submitted requests and their votes are
-- not archived anywhere else, so this drop is the end of that data. Dump the
-- two tables before applying this if any of it is wanted.
--
-- Indexes, RLS policies, constraints and table comments drop with their tables,
-- so none of them is enumerated here. Order is child-then-parent because
-- `feature_request_votes.request_id` references `feature_requests`; no third
-- object depends on either table, so neither drop needs `cascade`.

drop table if exists public.feature_request_votes;
drop table if exists public.feature_requests;
