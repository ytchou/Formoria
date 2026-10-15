-- Reverts 20261015120000_drop_orphan_functions.sql (DEV-2036).
-- Recreates the seven functions from pg_get_functiondef on production (2026-10-15;
-- staging md5s identical). DROP discarded their ACLs and Supabase default privileges
-- re-grant EXECUTE to anon/authenticated on create, so revoke by role name.

CREATE OR REPLACE FUNCTION public.apply_founding_fact_audit_patch(p_brand_id uuid, p_patch jsonb, p_expected jsonb, p_expected_protection jsonb, p_source text, p_actor uuid, p_allow_protected boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_brand public.brands%rowtype;
  v_field text;
  v_actual_protection text;
begin
  if p_source is null or p_source not in ('enriched', 'admin') then
    raise exception 'unsupported founding-fact audit source';
  end if;

  if (p_source = 'admin' and p_actor is null)
    or (p_allow_protected and p_source <> 'admin')
  then
    raise exception 'founding-fact audit actor does not match its source';
  end if;

  if p_patch = '{}'::jsonb
    or exists (
      select 1
      from jsonb_object_keys(p_patch) as key(field)
      where key.field not in ('city', 'founding_year')
    )
    or not (
      select coalesce(bool_and(p_expected ? key.field), false)
      from jsonb_object_keys(p_patch) as key(field)
    )
    or not (
      select coalesce(bool_and(p_expected_protection ? key.field), false)
      from jsonb_object_keys(p_patch) as key(field)
    )
  then
    raise exception 'founding-fact audit patch contains an unsupported or unguarded field';
  end if;

  select *
  into v_brand
  from public.brands
  where id = p_brand_id
  for update;

  if not found or v_brand.status <> 'approved' then
    return false;
  end if;

  for v_field in select jsonb_object_keys(p_patch)
  loop
    if (to_jsonb(v_brand) -> v_field) is distinct from (p_expected -> v_field) then
      return false;
    end if;

    select case
      when state.source = 'owner' then 'protected:owner'
      when state.source = 'admin' and state.updated_by is not null
        then 'protected:admin'
      else null
    end
    into v_actual_protection
    from public.brand_field_state as state
    where state.brand_id = p_brand_id
      and state.field = v_field;

    if coalesce(to_jsonb(v_actual_protection), 'null'::jsonb)
      is distinct from (p_expected_protection -> v_field)
    then
      return false;
    end if;

    if not p_allow_protected and v_actual_protection is not null then
      return false;
    end if;
  end loop;

  perform public.apply_brand_patch(
    p_brand_id,
    p_patch,
    p_source,
    p_actor,
    null
  );
  return true;
end;
$function$;

revoke all on function public.apply_founding_fact_audit_patch(uuid,jsonb,jsonb,jsonb,text,uuid,boolean) from public;
revoke all on function public.apply_founding_fact_audit_patch(uuid,jsonb,jsonb,jsonb,text,uuid,boolean) from anon;
revoke all on function public.apply_founding_fact_audit_patch(uuid,jsonb,jsonb,jsonb,text,uuid,boolean) from authenticated;
grant execute on function public.apply_founding_fact_audit_patch(uuid,jsonb,jsonb,jsonb,text,uuid,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.rearm_health_fix_canary(p_fingerprint text)
 RETURNS SETOF health_fix_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_fingerprint is null or btrim(p_fingerprint) = '' then
    raise exception 'fingerprint is required';
  end if;

  if p_fingerprint not like '%:canary:%' then
    raise exception 'rearm is restricted to canary fingerprints: %', p_fingerprint;
  end if;

  -- Exactly one row, not every row sharing the fingerprint. The queue keeps
  -- terminal history (`fixed`, `skipped`) alongside the live row, and
  -- health_fix_queue_active_fingerprint_idx is a partial unique index over the
  -- active statuses — so re-arming every historical row tries to make four rows
  -- active at once and fails with 23505. Target only the row currently holding
  -- the active slot; if it is already pending there is nothing to do.
  return query
  update public.health_fix_queue as queue
  set status = 'pending',
      lease_owner = null,
      lease_expires_at = null,
      attempt_count = 0,
      last_error = null,
      next_attempt_at = now(),
      updated_at = now()
  where queue.id = (
    select active.id
    from public.health_fix_queue as active
    where active.fingerprint = p_fingerprint
      and active.status in (
        'claimed',
        'pr_opened',
        'awaiting_human',
        'merged',
        'deployed',
        'failed',
        'needs_human'
      )
    order by active.updated_at desc
    limit 1
  )
  returning queue.*;
end;
$function$;

revoke all on function public.rearm_health_fix_canary(text) from public;
revoke all on function public.rearm_health_fix_canary(text) from anon;
revoke all on function public.rearm_health_fix_canary(text) from authenticated;
grant execute on function public.rearm_health_fix_canary(text) to service_role;

CREATE OR REPLACE FUNCTION public.record_health_snapshot(p_snapshot_date date, p_metrics jsonb)
 RETURNS health_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.health_snapshots%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_metrics) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'metrics must be a JSON object';
  END IF;

  INSERT INTO public.health_snapshots AS snapshot (snapshot_date, metrics)
  VALUES (p_snapshot_date, p_metrics)
  ON CONFLICT (snapshot_date) DO UPDATE
  SET metrics = EXCLUDED.metrics,
      updated_at = now()
  RETURNING snapshot.* INTO v_row;

  RETURN v_row;
END;
$function$;

revoke all on function public.record_health_snapshot(date,jsonb) from public;
revoke all on function public.record_health_snapshot(date,jsonb) from anon;
revoke all on function public.record_health_snapshot(date,jsonb) from authenticated;
grant execute on function public.record_health_snapshot(date,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.record_link_health_result(p_brand_id uuid, p_field text, p_url text, p_status_code integer, p_checked_at timestamp with time zone DEFAULT now())
 RETURNS link_check_results
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.link_check_results%ROWTYPE;
  v_is_healthy boolean := p_status_code BETWEEN 200 AND 399;
  -- Failure evidence is recorded for error statuses, but NOT (403, 429).
  v_is_rate_limited boolean := p_status_code IN (403, 429);
  v_failure_reason text := CASE
    WHEN p_status_code IS NULL OR v_is_healthy OR v_is_rate_limited THEN NULL
    ELSE 'http'
  END;
  v_is_deterministic_storage_failure boolean :=
    p_status_code IN (404, 410) AND p_url LIKE '%/storage/v1/object/%';
BEGIN
  INSERT INTO public.link_check_results AS result (
    brand_id,
    field,
    url,
    last_status_code,
    failure_reason,
    last_ok_at,
    last_checked_at,
    consecutive_failures,
    failure_dates,
    distinct_failure_days,
    cleanup_required,
    cleanup_required_at
  ) VALUES (
    p_brand_id,
    p_field,
    p_url,
    p_status_code,
    v_failure_reason,
    CASE WHEN v_is_healthy THEN p_checked_at ELSE NULL END,
    p_checked_at,
    CASE WHEN v_is_healthy OR v_is_rate_limited THEN 0 ELSE 1 END,
    CASE
      WHEN v_is_healthy OR v_is_rate_limited THEN '{}'::date[]
      ELSE ARRAY[p_checked_at::date]
    END,
    CASE WHEN v_is_healthy OR v_is_rate_limited THEN 0 ELSE 1 END,
    v_is_deterministic_storage_failure,
    CASE WHEN v_is_deterministic_storage_failure THEN p_checked_at ELSE NULL END
  )
  ON CONFLICT (brand_id, field) DO UPDATE
  SET url = EXCLUDED.url,
      last_status_code = EXCLUDED.last_status_code,
      failure_reason = EXCLUDED.failure_reason,
      last_checked_at = EXCLUDED.last_checked_at,
      last_ok_at = CASE WHEN v_is_healthy THEN p_checked_at ELSE result.last_ok_at END,
      consecutive_failures = CASE
        WHEN v_is_healthy THEN 0
        WHEN v_is_rate_limited THEN result.consecutive_failures
        ELSE result.consecutive_failures + 1
      END,
      failure_dates = CASE
        WHEN v_is_healthy THEN '{}'::date[]
        WHEN v_is_rate_limited OR p_checked_at::date = ANY(result.failure_dates)
          THEN result.failure_dates
        ELSE array_append(result.failure_dates, p_checked_at::date)
      END,
      distinct_failure_days = CASE
        WHEN v_is_healthy THEN 0
        WHEN v_is_rate_limited OR p_checked_at::date = ANY(result.failure_dates)
          THEN result.distinct_failure_days
        ELSE result.distinct_failure_days + 1
      END,
      cleanup_required = CASE
        WHEN v_is_healthy THEN false
        WHEN v_is_rate_limited THEN result.cleanup_required
        WHEN v_is_deterministic_storage_failure THEN true
        WHEN p_checked_at::date = ANY(result.failure_dates)
          THEN result.distinct_failure_days >= 3
        ELSE result.distinct_failure_days + 1 >= 3
      END,
      cleanup_required_at = CASE
        WHEN v_is_healthy THEN NULL
        WHEN v_is_rate_limited OR result.cleanup_required THEN result.cleanup_required_at
        WHEN v_is_deterministic_storage_failure THEN p_checked_at
        WHEN p_checked_at::date <> ALL(result.failure_dates)
          AND result.distinct_failure_days + 1 >= 3 THEN p_checked_at
        ELSE NULL
      END,
      updated_at = now()
  RETURNING result.* INTO v_row;

  RETURN v_row;
END;
$function$;

revoke all on function public.record_link_health_result(uuid,text,text,integer,timestamp with time zone) from public;
revoke all on function public.record_link_health_result(uuid,text,text,integer,timestamp with time zone) from anon;
revoke all on function public.record_link_health_result(uuid,text,text,integer,timestamp with time zone) from authenticated;
grant execute on function public.record_link_health_result(uuid,text,text,integer,timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.transition_health_fix(p_id uuid, p_expected_status text, p_new_status text, p_lease_owner text DEFAULT NULL::text, p_last_error text DEFAULT NULL::text, p_next_attempt_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pr_number bigint DEFAULT NULL::bigint, p_pr_url text DEFAULT NULL::text, p_merge_sha text DEFAULT NULL::text, p_deployed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_confirmation_data jsonb DEFAULT NULL::jsonb)
 RETURNS health_fix_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.health_fix_queue%ROWTYPE;
  v_target_status text := p_new_status;
BEGIN
  SELECT * INTO v_row
  FROM public.health_fix_queue
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'invalid health fix transition: expected %, found %',
      p_expected_status,
      COALESCE(v_row.status, '<missing>');
  END IF;

  IF v_row.status = 'claimed'
     AND v_row.lease_owner IS DISTINCT FROM p_lease_owner THEN
    RAISE EXCEPTION 'invalid health fix transition: lease owner mismatch';
  END IF;

  IF NOT (
    (v_row.status = 'claimed' AND p_new_status IN ('pr_opened', 'failed', 'skipped', 'needs_human'))
    OR (v_row.status = 'pr_opened' AND p_new_status IN ('awaiting_human', 'merged', 'failed', 'needs_human'))
    OR (v_row.status = 'awaiting_human' AND p_new_status IN ('merged', 'failed', 'skipped', 'needs_human'))
    OR (v_row.status = 'merged' AND p_new_status IN ('deployed', 'failed', 'needs_human'))
    OR (v_row.status = 'deployed' AND p_new_status IN ('fixed', 'failed', 'needs_human'))
  ) THEN
    RAISE EXCEPTION 'invalid health fix transition: % to %', v_row.status, p_new_status;
  END IF;

  IF p_new_status = 'failed' AND v_row.attempt_count >= 2 THEN
    v_target_status := 'needs_human';
  END IF;

  UPDATE public.health_fix_queue
  SET status = v_target_status,
      lease_owner = CASE WHEN v_target_status = 'claimed' THEN lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN v_target_status = 'claimed' THEN lease_expires_at ELSE NULL END,
      last_error = p_last_error,
      next_attempt_at = CASE WHEN v_target_status = 'failed' THEN p_next_attempt_at ELSE NULL END,
      pr_number = COALESCE(p_pr_number, pr_number),
      pr_url = COALESCE(p_pr_url, pr_url),
      merge_sha = COALESCE(p_merge_sha, merge_sha),
      deployed_at = CASE
        WHEN v_target_status = 'deployed' THEN COALESCE(p_deployed_at, now())
        ELSE deployed_at
      END,
      confirmation_data = COALESCE(p_confirmation_data, confirmation_data),
      fixed_at = CASE WHEN v_target_status = 'fixed' THEN now() ELSE fixed_at END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

revoke all on function public.transition_health_fix(uuid,text,text,text,text,timestamp with time zone,bigint,text,text,timestamp with time zone,jsonb) from public;
revoke all on function public.transition_health_fix(uuid,text,text,text,text,timestamp with time zone,bigint,text,text,timestamp with time zone,jsonb) from anon;
revoke all on function public.transition_health_fix(uuid,text,text,text,text,timestamp with time zone,bigint,text,text,timestamp with time zone,jsonb) from authenticated;
grant execute on function public.transition_health_fix(uuid,text,text,text,text,timestamp with time zone,bigint,text,text,timestamp with time zone,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.update_brand_channel_districts(p_updates jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with updated as (
    update public.brand_channels as channel
    set
      district = update_row.district,
      updated_at = now()
    from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as update_row(
      id uuid,
      district text
    )
    where channel.id = update_row.id
    returning channel.id
  )
  select count(*)::integer from updated;
$function$;

revoke all on function public.update_brand_channel_districts(jsonb) from public;
revoke all on function public.update_brand_channel_districts(jsonb) from anon;
revoke all on function public.update_brand_channel_districts(jsonb) from authenticated;
grant execute on function public.update_brand_channel_districts(jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.verify_health_fix_absence(p_id uuid, p_expected_status text)
 RETURNS health_fix_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.health_fix_queue%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_expected_status IS NULL THEN
    RAISE EXCEPTION 'health fix id and expected status are required';
  END IF;

  SELECT * INTO v_row
  FROM public.health_fix_queue
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid health fix absence: row % is missing', p_id;
  END IF;

  IF v_row.status = 'fixed' THEN
    RAISE EXCEPTION 'invalid health fix absence: row % is already fixed', p_id;
  END IF;

  IF v_row.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'invalid health fix absence: expected %, found %',
      p_expected_status,
      COALESCE(v_row.status, '<missing>');
  END IF;

  UPDATE public.health_fix_queue
  SET status = 'fixed',
      fixed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      confirmation_data = COALESCE(confirmation_data, '{}'::jsonb) ||
        jsonb_build_object(
          'verification', 'provider_resolved_after_detector_absence',
          'verified_at', now()
        ),
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

revoke all on function public.verify_health_fix_absence(uuid,text) from public;
revoke all on function public.verify_health_fix_absence(uuid,text) from anon;
revoke all on function public.verify_health_fix_absence(uuid,text) from authenticated;
grant execute on function public.verify_health_fix_absence(uuid,text) to service_role;
