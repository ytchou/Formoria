-- `subcategory_label_key` strips U+FEFF, closing the last divergence from
-- `normalizeSubcategoryKey` (DEV-1510 follow-up).
--
-- ---------------------------------------------------------------------------
-- WHAT DIVERGED, AND WHAT DID NOT
-- ---------------------------------------------------------------------------
--
-- `20260820130000_backfill_subcategory_slugs.sql:184` documents the SQL helper
-- as byte-compatible with `normalizeSubcategoryKey` (`src/lib/taxonomy/
-- ontology.ts`). It is, on every whitespace codepoint except one:
--
--   U+00A0 NO-BREAK SPACE      converges — NFKC folds it to U+0020 on both sides
--   U+2000..U+200A (EN/EM/…)   converges — same reason
--   U+FEFF ZWNBSP / BOM        DIVERGES
--
-- Verified against staging and against the TypeScript, not assumed:
--
--   select public.subcategory_label_key(U&'\FEFF' || '後背包');  ->  '﻿後背包'
--   '﻿後背包'.normalize('NFKC').trim()                      ->  '後背包'
--
-- JavaScript's `String.prototype.trim` treats U+FEFF as whitespace (it is in
-- the spec's WhiteSpace production). Postgres does not: U+FEFF is category Cf,
-- so neither `\s` in `regexp_replace` nor the default `btrim` set removes it.
--
-- The consequence is not a wrong label, it is an ABORTED DEPLOY. A value
-- carrying a BOM — pasted from a spreadsheet export, or read from a
-- BOM-prefixed CSV — normalizes clean in TypeScript, so both write-path schemas
-- accept it and it is stored. In SQL it then keys as `﻿後背包`, which has no row
-- in `subcategory_label_map`, so the strict resolver raises P0001 and rolls back
-- whatever statement touched it: the backfill mid-deploy, or `approve_submission`
-- on a submission the review UI validated as clean.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW FILE INSTEAD OF EDITING 20260820130000
-- ---------------------------------------------------------------------------
--
-- That migration is already applied to staging. Editing an applied file leaves
-- the ledger claiming a version whose bytes no longer exist, and no environment
-- that already ran it would ever pick the fix up.
--
-- `create or replace` rather than `drop` + `create`: the signature is unchanged,
-- and a drop would discard the ACL and re-apply Supabase's public-schema
-- defaults, handing `anon` EXECUTE back on a helper that reads the private map.
-- The closing block verifies the ACL survived rather than trusting that.

create or replace function public.subcategory_label_key(p_label text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select btrim(
    regexp_replace(
      lower(
        replace(
          replace(normalize(p_label, NFKC), U&'\30FB', ''),
          -- U+FEFF, the one codepoint `String.prototype.trim` removes and
          -- Postgres does not. Removed everywhere in the string rather than
          -- only at the ends: a BOM in the middle is not a character either.
          U&'\FEFF', ''
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;

comment on function public.subcategory_label_key(text) is
  'DEV-1510: the single matching basis for subcategory strings, byte-compatible with normalizeSubcategoryKey in src/lib/taxonomy/ontology.ts — NFKC, strip U+30FB, strip U+FEFF, lowercase, collapse whitespace, trim.';

-- Parity, asserted rather than described. Each pair is one codepoint class the
-- two implementations have to agree on; the BOM row is the one this file fixes.
do $migration$
declare
  v_probe text;
  v_key text;
begin
  foreach v_probe in array array[
    U&'\FEFF' || '後背包',
    '後背包' || U&'\FEFF',
    U&'\FEFF' || '後背包' || U&'\FEFF',
    ' ' || U&'\00A0' || '後背包 ',
    U&'\2003' || '後背包',
    '  後背包  '
  ]
  loop
    v_key := public.subcategory_label_key(v_probe);
    if v_key <> '後背包' then
      raise exception
        'DEV-1510 subcategory_label_key(%) = %, expected 後背包',
        quote_literal(v_probe), quote_literal(v_key)
        using errcode = 'P0001';
    end if;
  end loop;

  -- And the key is now resolvable, which is the property that matters: before
  -- this fix the BOM-carrying spelling had no row in the map.
  if not exists (
    select 1 from public.subcategory_label_map
    where label_key = public.subcategory_label_key(U&'\FEFF' || '後背包')
  ) then
    raise exception 'DEV-1510 BOM-carrying label still resolves to no map row'
      using errcode = 'P0001';
  end if;
end
$migration$;

-- `create or replace` preserves the ACL, so this verifies rather than repairs.
do $migration$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if pg_catalog.has_function_privilege(
      v_role, 'public.subcategory_label_key(text)', 'EXECUTE'
    ) then
      raise exception
        'DEV-1510 public.subcategory_label_key(text) is executable by %', v_role
        using errcode = 'P0001';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'service_role', 'public.subcategory_label_key(text)', 'EXECUTE'
  ) then
    raise exception
      'DEV-1510 public.subcategory_label_key(text) is NOT executable by service_role'
      using errcode = 'P0001';
  end if;
end
$migration$;
