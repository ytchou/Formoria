#!/usr/bin/env bash

# Verify that the findings this run claimed are actually gone.
#
# The validate stage used to run `pnpm knip` directly. Knip exits non-zero while
# *any* unused symbol remains anywhere in the repository, but a run only ever
# claims up to HEALTH_REPAIR_CLAIM_LIMIT findings — so the gate demanded a
# repo-wide clean bill of health for a repair that was never scoped to deliver
# one. It could not pass while a backlog existed, which is precisely when the
# health agent has work to do. Run 31451295997 died here with 25 quality
# findings claimed and repaired: knip still listed the other unclaimed symbols,
# the step exited 1 under `bash -e`, and review and publish never ran.
#
# The detector is the right verifier, scoped to the claim: re-run the quality
# collector and assert that no fingerprint this run claimed still appears.
# Findings outside the claim are someone else's turn.

set -euo pipefail

snapshot_path="${1:?Manager snapshot path is required}"
recheck_path="${2:?Quality recheck artifact path is required}"
# Optional: the repair agent's own per-finding ledger for this cycle. A survivor
# the agent deliberately declined to fix reads identically to one it crashed on,
# so print its self-reported status and summary next to the fingerprint when the
# ledger is available (DEV-1435).
repair_result_path="${3:-}"

test -f "$snapshot_path"
test -f "$recheck_path"

remaining_file="$(mktemp)"
trap 'rm -f "$remaining_file"' EXIT

# `-e` on the outer jq would make "no findings survived" an error exit, which is
# the success case here.
jq -r --slurpfile recheck "$recheck_path" '
  [$recheck[0].findings[]?.fingerprint] as $current
  | [.findings[]?.fingerprint | select(startswith("quality:"))]
  | map(select(. as $claimed | $current | index($claimed)))
  | .[]
' "$snapshot_path" | sort -u > "$remaining_file"

if [[ -s "$remaining_file" ]]; then
  echo "Claimed findings still reported after repair:" >&2
  if [[ -n "$repair_result_path" && -s "$repair_result_path" ]]; then
    jq -R -r --slurpfile repair "$repair_result_path" '
      . as $fingerprint
      | ([$repair[0].findings[]? | select(.fingerprint == $fingerprint)] | first) as $entry
      | if $entry == null then
          "  \($fingerprint) — agent reported no ledger entry"
        else
          "  \($fingerprint) — \($entry.status // "unknown"): \($entry.summary // "no summary")"
        end
    ' "$remaining_file" >&2
  else
    sed 's/^/  /' "$remaining_file" >&2
    echo "  (no repair ledger captured for this cycle — reason unavailable)" >&2
  fi
  exit 1
fi

echo "All claimed quality findings resolved."
