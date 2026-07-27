#!/usr/bin/env bash
set -euo pipefail

source_run_id="${1:?usage: replay-run.sh SOURCE_RUN_ID [DOWNLOADED_ARTIFACT_DIRECTORY] [consolidate|report|repair]}"
source_attempt="${SOURCE_ATTEMPT:-1}"
provided_root="${2:-}"
action="${3:-report}"
temp_root=""

cleanup() {
  if [[ -n "$temp_root" && -d "$temp_root" ]]; then
    rm -rf -- "$temp_root"
  fi
}
trap cleanup EXIT INT TERM

case "$action" in consolidate|report|repair) ;; *) echo "Invalid replay action: $action" >&2; exit 1 ;; esac

if [[ -n "$provided_root" ]]; then
  source_root="$provided_root"
else
  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/formoria-health-replay.XXXXXX")"
  source_root="$temp_root"
  gh run download "$source_run_id" \
    --name "health-run-${source_run_id}-${source_attempt}" \
    --dir "$source_root"
fi

run_file="$(/usr/bin/find "$source_root" -type f -name health-run.json -print -quit)"
[[ -n "$run_file" ]] || { echo "Missing replay artifact: health-run.json" >&2; exit 1; }

case "$action" in
  consolidate)
    jq --arg source_run_id "$source_run_id" '{sourceRunId:$source_run_id,groups,canonicalFindings:([.groups.product.link.findings[],.groups.product.directory.findings[],.groups.runtime.findings[],.groups.repository.findings[]]|unique_by(.fingerprint)),lifecycle}' "$run_file"
    ;;
  report)
    jq --arg source_run_id "$source_run_id" '{sourceRunId:$source_run_id,managerReport}' "$run_file"
    ;;
  repair)
    jq --arg source_run_id "$source_run_id" '{sourceRunId:$source_run_id,publication:.repair,repairableFindings:[.canonicalFindings[]|select(.evidence.repairScopeTrusted == true and (.changedFiles|length)>0)]}' "$run_file"
    ;;
esac
