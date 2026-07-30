begin;

-- Lower the publishable-core image floor from two active images to one.
--
-- getSubmissionReviewCompleteness only ever required a hero image, so the admin
-- queue has been showing single-image submissions as "complete" while the
-- database refused them with "must satisfy publishable core" at approve time.
-- One good hero image is enough to publish a brand; the hero invariants below
-- this clause are untouched, so zero-image submissions are still rejected and
-- the hero must still be the single active sort_order = 0 row.
--
-- Patches the live function bodies by text replacement, the same way
-- 20260728071406_align_submission_publishable_links.sql does, because these
-- guards live inside large functions that several migrations have amended.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef(
    'public.approve_submission(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$
      select count(distinct image.url)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
    ) < 2$old$,
    $new$
      select count(distinct image.url)
      from public.submission_images as image
      where image.submission_id = p_submission_id
        and image.status = 'active'
    ) < 1$new$
  );

  if v_updated_definition = v_definition then
    raise exception 'approve_submission image-floor guard was not found';
  end if;
  execute v_updated_definition;

  select pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  ) into v_definition;

  v_updated_definition := replace(
    v_definition,
    $old$
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
    ) not between 2 and 7$old$,
    $new$
      select count(*)
      from public.submission_images as image
      where image.submission_id = p_submission_id and image.status = 'active'
    ) not between 1 and 7$new$
  );

  if v_updated_definition = v_definition then
    raise exception 'apply_brand_refresh image-floor guard was not found';
  end if;
  execute v_updated_definition;
end
$migration$;

commit;
