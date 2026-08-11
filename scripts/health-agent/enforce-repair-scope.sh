#!/usr/bin/env bash

# Revert working-tree changes the repair agent made outside its claim.
#
# A claim's `changedFiles` is the contract: it is the set of paths the run is
# permitted to touch, and the publish step already stages exactly that set. An
# edit outside it was never going to reach the PR — but it *was* reaching
# validation, because `pnpm lint` and `tsc` see the whole working tree.
#
# Run 31472080866 died exactly this way. The repair edited
# src/instrumentation-client.ts, a file in no claim, and validation failed at
# `check:audited-calls` on a stray `analytics.google.com` reference. Both repair
# cycles burned, no PR opened, and the diagnostic pointed at a file the run had
# no business touching — so the failure read as a lint regression rather than as
# the scope violation it was.
#
# validate-repair-patch.sh already asserts this allowlist, but it runs last, so
# the confusing lint error always fired first. This runs before validation and
# reverts instead of asserting: the out-of-scope edit is discarded, and the run
# continues on the work it actually claimed. If the repair genuinely needed a
# file outside its claim, reverting leaves the tree inconsistent and validation
# fails anyway — the same outcome as before, with the cause named out loud here.
#
# This deletes untracked files and discards tracked edits by design. It is meant
# for the ephemeral CI checkout. Do not run it against a working tree you care
# about: anything outside the claim is gone.

set -euo pipefail

metadata_path="${1:?Repair metadata path is required}"
merge_policy="${2:-human}"

git rev-parse --show-toplevel >/dev/null
test -f "$metadata_path"

allowed_file="$(mktemp)"
reverted_file="$(mktemp)"
trap 'rm -f "$allowed_file" "$reverted_file"' EXIT

jq -er --arg policy "$merge_policy" '
  .[$policy].traceability[]?.changedFiles[]?
  | select(type == "string" and length > 0)
' "$metadata_path" | sort -u > "$allowed_file"

test -s "$allowed_file"

in_scope() {
  grep -Fqx -- "$1" "$allowed_file"
}

# Tracked modifications outside the claim: restore from HEAD.
while IFS= read -r -d '' path; do
  in_scope "$path" && continue
  git checkout HEAD -- "$path"
  printf 'reverted (tracked)   %s\n' "$path" >> "$reverted_file"
done < <(git diff --name-only -z --no-renames -- ; git diff --cached --name-only -z --no-renames --)

# Untracked files outside the claim: delete. The artifact directory is this
# run's own output, not a repair edit, so it is excluded rather than removed.
while IFS= read -r -d '' path; do
  in_scope "$path" && continue
  rm -f -- "$path"
  printf 'reverted (untracked) %s\n' "$path" >> "$reverted_file"
done < <(git ls-files --others --exclude-standard -z -- . ':(exclude).health-agent-artifacts/**')

if [[ -s "$reverted_file" ]]; then
  echo "Discarded repair edits outside the claimed changedFiles:" >&2
  sed 's/^/  /' "$reverted_file" >&2
  echo "The claim allows only:" >&2
  sed 's/^/  /' "$allowed_file" >&2
else
  echo "Repair stayed within its claimed changedFiles."
fi
