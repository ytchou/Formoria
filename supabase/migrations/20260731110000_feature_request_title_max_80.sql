-- Title is a subject line, not a description: 120 chars invited paragraphs.
-- Truncation first so the constraint swap cannot fail on an existing row;
-- verified safe at write time (longest known title is 38 chars).
update public.feature_requests
set title = left(title, 80)
where char_length(title) > 80;

alter table public.feature_requests
  drop constraint if exists feature_requests_title_check;

alter table public.feature_requests
  add constraint feature_requests_title_check
  check (char_length(title) between 4 and 80);
