-- DEV-1510 Task 9, sites 8/7 and 9/7 — the two conversion-on-read holes the
-- plan's implementation note did not name.
--
-- 20260820130000 converted every stored surface and patched `approve_submission`
-- to convert its own input. Two sibling paths read the SAME submission
-- containers and were left comparing or writing zh-TW labels against a
-- slug-stored catalogue:
--
--   8/7  correct_approved_submission_provenance()
--        Compares `to_jsonb(brand) -> 'subcategories'` (now SLUGS) against
--        `suggested_tags` / `owner_data.subcategories` (still LABELS) to decide
--        whether a published value came from the submitter. The comparison can
--        no longer match, so every approved brand's `subcategories` provenance
--        silently downgrades from `submitted`/`owner` to `enriched`.
--
--        That is not cosmetic. 品牌提供 — brand-supplied — is one of the four
--        public trust labels, and `brand_field_state.source` is what decides it.
--        A wrong attribution here is a wrong public claim, and nothing but
--        `submission-review-rpc.integration.test.ts` would ever have caught it.
--
--   9/7  apply_brand_refresh_with_protected_location_gate()
--        Assembles `v_effective` from `base_brand_data` + the enrichment,
--        admin-override and cleared-field patches, then writes `subcategories`
--        and `subcategories_en` straight onto `public.brands`. A refresh
--        submission created before the deploy — or produced by an enrichment
--        run whose prompt still emits zh-TW labels until DEV-1510 task 16 —
--        writes LABELS back into a slug-stored column, one brand at a time,
--        with no error. It would silently un-migrate the catalogue.
--
-- ---------------------------------------------------------------------------
-- STRICT HERE, TOLERANT THERE — and the reason is which failure is worse
-- ---------------------------------------------------------------------------
--
-- 9/7 uses the STRICT resolver: it WRITES to `brands`, so an unresolvable label
-- must abort the refresh exactly as it aborts the backfill. A silent write of
-- an unknown label is the failure this whole ticket exists to remove.
--
-- 8/7 swallows the exception: it only ATTRIBUTES. A vocabulary gap there must
-- degrade to the pre-existing (wrong-but-harmless) `enriched` attribution, not
-- roll back an approval that has already inserted a brand. Blocking a
-- publication to protect a provenance label inverts the cost.
--
-- ---------------------------------------------------------------------------
-- DUMP PROVENANCE — neither function has a source file
-- ---------------------------------------------------------------------------
--
-- Re-materialized live from staging (`xwkigpvnheecihpxyvsl`) at
-- **2026-08-19 09:22:10 UTC**, with:
--
--   psql "$SUPABASE_DB_URL" -At -c "
--     select p.oid::regprocedure::text,
--            md5(pg_get_functiondef(p.oid)),
--            length(pg_get_functiondef(p.oid))
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in (
--         'correct_approved_submission_provenance',
--         'apply_brand_refresh_with_protected_location_gate'
--       )
--     order by 1"
--
-- which returned:
--
--   apply_brand_refresh_with_protected_location_gate(uuid,uuid)
--     | 67c04c2be0353ed3f77fc7f85fee6321 | 14912 bytes
--   correct_approved_submission_provenance()
--     | bd9d4fe3301061dfeef1b7e9b15d3aad |  3434 bytes
--
-- Both md5s are the post-20260820090000 bodies and are asserted before anything
-- is rewritten. Neither body is re-typed here: each is read back with
-- pg_get_functiondef at run time and anchor-patched at exactly one literal.
--
-- `purchase_channel_sql_surface()` snapshots both, re-materializing them at CALL
-- time, so the re-pin needs no edit — only the proof in the closing block.

begin;

create or replace function public.dev1503_contract_assert_function(
  p_signature regprocedure,
  p_expected_md5 text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(p_signature);
  if md5(v_definition) is distinct from p_expected_md5 then
    raise exception
      'DEV-1503 function fingerprint drift for %: expected %, got %',
      p_signature, p_expected_md5, md5(v_definition)
      using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function public.dev1503_contract_replace_exact(
  p_definition text,
  p_legacy text,
  p_final text,
  p_expected_count integer
)
returns text
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer;
begin
  v_count :=
    (length(p_definition) - length(replace(p_definition, p_legacy, '')))
    / nullif(length(p_legacy), 0);
  if v_count is distinct from p_expected_count then
    raise exception
      'DEV-1503 replacement drift for % -> %: expected %, got %',
      p_legacy, p_final, p_expected_count, v_count
      using errcode = 'P0001';
  end if;
  return replace(p_definition, p_legacy, p_final);
end;
$function$;

do $migration$
declare
  v_body text;
  v_legacy text;
  v_final text;
begin
  -- =========================================================================
  -- 8/7 — correct_approved_submission_provenance
  -- =========================================================================
  perform public.dev1503_contract_assert_function(
    'public.correct_approved_submission_provenance()'::regprocedure,
    'bd9d4fe3301061dfeef1b7e9b15d3aad'
  );

  -- The four-space indent and the blank line are PART OF THE ANCHOR:
  -- dev1503_contract_replace_exact matches bytes, not SQL tokens.
  v_legacy :=
    $anchor$    )), '{}'::jsonb);$anchor$ || E'\n\n' ||
    $anchor$    insert into public.brand_field_state ($anchor$;

  v_final :=
    $anchor$    )), '{}'::jsonb);$anchor$ || E'\n\n' ||
    $anchor$    -- DEV-1510: the brand now stores English slugs, the submission$anchor$ || E'\n' ||
    $anchor$    -- containers still hold whatever the submitter typed. Compare like$anchor$ || E'\n' ||
    $anchor$    -- with like, or every published subcategory loses its `submitted`$anchor$ || E'\n' ||
    $anchor$    -- attribution and is re-labelled `enriched` — a wrong public trust$anchor$ || E'\n' ||
    $anchor$    -- claim, not a cosmetic one.$anchor$ || E'\n' ||
    $anchor$    --$anchor$ || E'\n' ||
    $anchor$    -- Tolerant on purpose: attribution must never roll back an approval$anchor$ || E'\n' ||
    $anchor$    -- that has already inserted a brand, so a vocabulary gap degrades to$anchor$ || E'\n' ||
    $anchor$    -- the pre-existing `enriched` answer instead of raising.$anchor$ || E'\n' ||
    $anchor$    if jsonb_typeof(v_raw_data -> 'subcategories') = 'array' then$anchor$ || E'\n' ||
    $anchor$      begin$anchor$ || E'\n' ||
    $anchor$        v_raw_data := jsonb_set($anchor$ || E'\n' ||
    $anchor$          v_raw_data,$anchor$ || E'\n' ||
    $anchor$          '{subcategories}',$anchor$ || E'\n' ||
    $anchor$          public.subcategory_json_to_slugs(v_raw_data -> 'subcategories')$anchor$ || E'\n' ||
    $anchor$        );$anchor$ || E'\n' ||
    $anchor$      exception when others then$anchor$ || E'\n' ||
    $anchor$        null;$anchor$ || E'\n' ||
    $anchor$      end;$anchor$ || E'\n' ||
    $anchor$    end if;$anchor$ || E'\n\n' ||
    $anchor$    insert into public.brand_field_state ($anchor$;

  v_body := pg_get_functiondef(
    'public.correct_approved_submission_provenance()'::regprocedure
  );
  v_body := public.dev1503_contract_replace_exact(v_body, v_legacy, v_final, 1);
  execute v_body;

  -- =========================================================================
  -- 9/7 — apply_brand_refresh_with_protected_location_gate
  -- =========================================================================
  perform public.dev1503_contract_assert_function(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure,
    '67c04c2be0353ed3f77fc7f85fee6321'
  );

  v_legacy :=
    $anchor$  v_effective := (v_submission.base_brand_data - '_active_images')$anchor$ || E'\n' ||
    $anchor$    || v_cleared_patch || v_enrichment_patch || v_admin_patch;$anchor$;

  v_final :=
    v_legacy || E'\n\n' ||
    $anchor$  -- DEV-1510: everything above is submission jsonb, which may still hold$anchor$ || E'\n' ||
    $anchor$  -- zh-TW labels — a refresh created before the deploy, or an enrichment$anchor$ || E'\n' ||
    $anchor$  -- run whose prompt still emits them. This writes straight onto$anchor$ || E'\n' ||
    $anchor$  -- public.brands, so an un-converted payload would un-migrate the$anchor$ || E'\n' ||
    $anchor$  -- catalogue one brand at a time with no error. STRICT: an unresolvable$anchor$ || E'\n' ||
    $anchor$  -- label aborts the refresh, exactly as it aborts the backfill.$anchor$ || E'\n' ||
    $anchor$  v_effective := public.subcategory_json_to_slugs(v_effective);$anchor$;

  v_body := pg_get_functiondef(
    'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
  );
  v_body := public.dev1503_contract_replace_exact(v_body, v_legacy, v_final, 1);
  execute v_body;
end
$migration$;

do $migration$
declare
  v_surface jsonb;
begin
  -- The publishable-core guard in the refresh body counts `subcategories`
  -- AFTER the conversion, which is the point: a payload whose only tags were
  -- evicted must fail the 1..5 guard rather than publish an empty array.
  if position(
    'v_effective := public.subcategory_json_to_slugs(v_effective);'
    in pg_get_functiondef(
      'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
    )
  ) >= position(
    'jsonb_array_length(v_effective -> ''subcategories'') not between 1 and 5'
    in pg_get_functiondef(
      'public.apply_brand_refresh_with_protected_location_gate(uuid,uuid)'::regprocedure
    )
  ) then
    raise exception
      'DEV-1510 refresh conversion must run BEFORE the publishable-core guard'
      using errcode = 'P0001';
  end if;

  v_surface := public.purchase_channel_sql_surface();
  if (v_surface -> 'functions' ->> 'correct_approved_submission_provenance')
       not like '%subcategory_json_to_slugs%'
    or (v_surface -> 'functions' ->> 'apply_brand_refresh_with_protected_location_gate')
       not like '%subcategory_json_to_slugs%'
  then
    raise exception
      'DEV-1510 purchase_channel_sql_surface re-pin missing a conversion-on-read call'
      using errcode = 'P0001';
  end if;
end
$migration$;

drop function public.dev1503_contract_assert_function(regprocedure, text);
drop function public.dev1503_contract_replace_exact(text, text, text, integer);

commit;
