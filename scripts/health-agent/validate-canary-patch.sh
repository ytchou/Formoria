#!/usr/bin/env bash

set -euo pipefail

snapshot_path="${1:?Canary snapshot path is required}"
expected_path="health-agent-canary.txt"

git rev-parse --show-toplevel >/dev/null
test -f "$snapshot_path"

changed_paths="$(git diff --name-only --)"
test "$changed_paths" = "$expected_path"

expected_marker="$(
  jq -er \
    --arg fingerprint "directory:canary:github-app-pr" \
    '.findings | map(select(.fingerprint == $fingerprint)) | if length == 1 and (.[0].evidence.desiredMarker | type) == "string" and (.[0].evidence.desiredMarker | length) > 0 then .[0].evidence.desiredMarker else error("invalid canary snapshot") end' \
    "$snapshot_path"
)"
actual_marker="$(cat "$expected_path")"
test "$actual_marker" = "$expected_marker"
