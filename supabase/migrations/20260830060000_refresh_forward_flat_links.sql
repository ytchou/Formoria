-- DEV-1653: request_brand_refresh does not forward flat link columns
-- (purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship,
-- social_instagram, social_threads, social_facebook, other_urls) from the
-- brand to the refresh submission. The discover phase reads
-- purchase_website from the submission row, so a null there forces a SERP
-- fallback that can resolve to the wrong domain entirely.

begin;

do $patch$
declare
  v_body text;
  v_col_anchor text := 'review_overrides,';
  v_val_anchor text := $$'{}'::jsonb, p_requested_by$$;
  v_new_cols text;
  v_new_vals text;
begin
  v_body := pg_get_functiondef(
    'public.request_brand_refresh(uuid,uuid,text)'::regprocedure
  );

  -- Guard: the columns must not already be present.
  if position('purchase_website' in v_body) > 0 then
    raise notice 'request_brand_refresh: purchase_website already present — skipping';
    return;
  end if;

  -- Guard: the anchors must exist exactly once.
  if (length(v_body) - length(replace(v_body, v_col_anchor, '')))
     / length(v_col_anchor) <> 1 then
    raise exception 'request_brand_refresh: column anchor "%" not unique', v_col_anchor;
  end if;
  if (length(v_body) - length(replace(v_body, v_val_anchor, '')))
     / length(v_val_anchor) <> 1 then
    raise exception 'request_brand_refresh: value anchor "%" not unique', v_val_anchor;
  end if;

  -- Inject flat link columns before review_overrides in the column list.
  v_new_cols :=
    'purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship,' || E'\n'
    || '    social_instagram, social_threads, social_facebook, other_urls,' || E'\n'
    || '    website_url,' || E'\n'
    || '    review_overrides,';

  v_body := replace(v_body, v_col_anchor, v_new_cols);

  -- Inject corresponding values before the '{}' review_overrides value.
  v_new_vals :=
    'v_brand.purchase_website, v_brand.purchase_pinkoi, v_brand.purchase_shopee, v_brand.purchase_myship,' || E'\n'
    || '    v_brand.social_instagram, v_brand.social_threads, v_brand.social_facebook, v_brand.other_urls,' || E'\n'
    || '    v_brand.purchase_website,' || E'\n'
    || $$    '{}'::jsonb, p_requested_by$$;

  v_body := replace(v_body, v_val_anchor, v_new_vals);

  -- Verify the patch landed.
  if position('purchase_website' in v_body) = 0 then
    raise exception 'request_brand_refresh: purchase_website not found after patching';
  end if;
  if position('website_url' in v_body) = 0 then
    raise exception 'request_brand_refresh: website_url not found after patching';
  end if;

  execute v_body;
end $patch$;

-- Re-assert grants (CREATE OR REPLACE preserves them, but be explicit).
revoke all on function public.request_brand_refresh(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_brand_refresh(uuid, uuid, text)
  to service_role;

commit;
