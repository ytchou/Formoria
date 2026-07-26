#!/usr/bin/env bash
set -euo pipefail

source_run_id="${1:?usage: replay-run.sh SOURCE_RUN_ID [DOWNLOADED_ARTIFACT_DIRECTORY]}"
source_attempt="${SOURCE_ATTEMPT:-1}"
provided_root="${2:-}"
temp_root=""

cleanup() {
  if [[ -n "$temp_root" && -d "$temp_root" ]]; then
    rm -rf -- "$temp_root"
  fi
}
trap cleanup EXIT INT TERM

if [[ -n "$provided_root" ]]; then
  source_root="$provided_root"
else
  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/formoria-health-replay.XXXXXX")"
  source_root="$temp_root/downloads"
  mkdir -p "$source_root"
  gh run download "$source_run_id" --dir "$source_root"
fi

stage_root="${temp_root:-$(mktemp -d "${TMPDIR:-/tmp}/formoria-health-replay.XXXXXX")}/stage"
if [[ -z "$temp_root" ]]; then
  temp_root="${stage_root%/stage}"
fi
mkdir -p "$stage_root"

copy_artifact() {
  local name="$1"
  local source
  source="$(/usr/bin/find "$source_root" -type f -name "$name" -print -quit)"
  [[ -n "$source" ]] || { echo "Missing replay artifact: $name" >&2; exit 1; }
  cp "$source" "$stage_root/$name"
}

copy_artifact link-checker.json
copy_artifact directory-health.json
copy_artifact sentry-triage.json
copy_artifact sentry-issues.json

pnpm exec tsx scripts/health-agent/write-sentry-schema.ts \
  "$stage_root/sentry-issues.json" "$stage_root/sentry-classification.schema.json" >/dev/null

pnpm exec tsx scripts/health-agent/workflow-runtime.ts aggregate-and-deliver \
  --mode preflight \
  --link-artifact "$stage_root/link-checker.json" \
  --directory-artifact "$stage_root/directory-health.json" \
  --sentry-artifact "$stage_root/sentry-triage.json" \
  --defer-delivery true \
  --run-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --attempt "$source_attempt" \
  --run-id "$source_run_id" \
  --output "$stage_root/aggregate.json"

analyze_status="$(jq -er '.status | if . == "failed" then "failure" else . end' "$stage_root/sentry-triage.json")"

pnpm exec tsx scripts/health-agent/workflow-runtime.ts final-report \
  --aggregate-artifact "$stage_root/aggregate.json" \
  --collect-status success \
  --analyze-status "$analyze_status" \
  --deliver-status success \
  --repair-status skipped \
  --publish-status skipped \
  --defer-delivery true \
  --run-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --attempt "$source_attempt" \
  --run-id "$source_run_id" \
  --output "$stage_root/final-report.json"

jq '{source_run_id: "'"$source_run_id"'", envelope: .envelope}' "$stage_root/final-report.json"
