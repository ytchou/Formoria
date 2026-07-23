#!/usr/bin/env bash

set -euo pipefail

metadata_path="${1:?Repair metadata path is required}"
merge_policy="${2:?Merge policy is required}"

case "$merge_policy" in
  automatic|human) ;;
  *) echo "Unsupported merge policy: $merge_policy" >&2; exit 1 ;;
esac

git rev-parse --show-toplevel >/dev/null
test -f "$metadata_path"

allowed_paths_file="$(mktemp)"
actual_paths_file="$(mktemp)"
trap 'rm -f "$allowed_paths_file" "$actual_paths_file"' EXIT

jq -er --arg policy "$merge_policy" '
  .[$policy] as $batch
  | if ($batch | type) != "object"
      or ($batch.finding_count | type) != "number"
      or ($batch.finding_count | floor) != $batch.finding_count
      or $batch.finding_count <= 0
      or ($batch.traceability | type) != "array"
      or ($batch.traceability | length) != $batch.finding_count
      or any($batch.traceability[]; (.changedFiles | type) != "array")
      or any($batch.traceability[].changedFiles[]; type != "string" or test("[\u0000-\u001f\u007f]"))
    then error("invalid repair metadata")
    else $batch.traceability[].changedFiles[]
    end
  | if type != "string" or length == 0 then error("invalid changed path") else . end
' "$metadata_path" | sort -u > "$allowed_paths_file"

test -s "$allowed_paths_file"

validate_path() {
  local candidate="$1"
  [[ -n "$candidate" ]]
  [[ "$candidate" != /* ]]
  [[ "$candidate" != ".git" && "$candidate" != .git/* ]]
  [[ "$candidate" != *'\'* ]]
  [[ ! "$candidate" =~ ^[A-Za-z]: ]]
  [[ ! "$candidate" =~ [[:cntrl:]] ]]

  local segment
  local segments=()
  IFS='/' read -r -a segments <<< "$candidate"
  for segment in "${segments[@]}"; do
    [[ -n "$segment" && "$segment" != "." && "$segment" != ".." ]]
  done
}

while IFS= read -r allowed_path; do
  if ! validate_path "$allowed_path"; then
    echo "Unsafe allowed repair path: $allowed_path" >&2
    exit 1
  fi
done < "$allowed_paths_file"

record_path() {
  local candidate="$1"
  if ! validate_path "$candidate"; then
    echo "Unsafe changed repair path" >&2
    exit 1
  fi
  printf '%s\n' "$candidate" >> "$actual_paths_file"
}

while IFS= read -r -d '' changed_path; do
  record_path "$changed_path"
done < <(
  git diff --name-only -z --no-renames --
  git diff --cached --name-only -z --no-renames --
)

while IFS= read -r -d '' untracked_path; do
  record_path "$untracked_path"
done < <(
  git ls-files --others --exclude-standard -z -- . ':(exclude).health-agent-artifacts/**'
)

sort -u -o "$actual_paths_file" "$actual_paths_file"
test -s "$actual_paths_file"

while IFS= read -r changed_path; do
  if ! grep -Fqx -- "$changed_path" "$allowed_paths_file"; then
    echo "Repair changed path outside metadata allowlist: $changed_path" >&2
    exit 1
  fi
done < "$actual_paths_file"
