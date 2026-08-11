#!/usr/bin/env bash

# Persist the repair agent's own structured result for one cycle.
#
# The repair steps report `is_error: false` whether the agent fixed every
# claimed finding or silently declined all of them, and the action runs with
# `show_full_output: false`, so the transcript never reaches the log. Without
# this file a refusal is indistinguishable from a crash, a no-op, or a misread
# snapshot, and the only recovery is a 20-minute re-run (DEV-1435).
#
# repair.md already requires a per-finding ledger; the workflow now passes a
# matching --json-schema so `structured_output` carries it. This writes that
# payload to the artifact directory, where validate reads it and the run
# artifact upload picks it up.
#
# Never fails the run: a missing or malformed ledger is a diagnostic gap, not a
# reason to abandon a repair that may have landed correct edits.

set -uo pipefail

cycle="${1:?Cycle number is required}"
output_path="${2:?Output path is required}"

payload="${REPAIR_RESULT:-}"

if [[ -z "${payload//[[:space:]]/}" ]]; then
  echo "::warning title=Repair cycle ${cycle} returned no structured output::the agent's per-finding ledger is unavailable for this cycle"
  printf '{}\n' > "$output_path"
  exit 0
fi

if ! jq -c . <<< "$payload" > "$output_path" 2>/dev/null; then
  echo "::warning title=Repair cycle ${cycle} returned unparsable structured output::the agent's per-finding ledger is unavailable for this cycle"
  printf '{}\n' > "$output_path"
  exit 0
fi

echo "Captured repair cycle ${cycle} result: $(jq -r '.status // "unknown"' "$output_path") (findings: $(jq -r '(.findings // []) | length' "$output_path"))"
