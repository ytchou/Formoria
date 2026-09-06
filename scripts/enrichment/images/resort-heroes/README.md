# Hero resort

This is a reviewed, ordering-only repair for active `brand_images` rows. It
shares `planHeroResort` with production classification. Resort refuses junk-tagged
or over-capacity brands; it never changes status, tags, storage, or image bytes.

Run in this order:

1. `pnpm resort-heroes:preview`
2. `pnpm resort-heroes:render`
3. Review the HTML artifact and its go/no-go alarms.
4. Pause the curation worker, then run `pnpm resort-heroes:apply -- --live`.
5. Keep the worker paused until the rollback decision is made. If needed, run
   `pnpm resort-heroes:rollback -- --manifest <manifest-path>`.

The curation worker in `src/lib/services/curation-operations.ts:2369` is the
only other `sort_order` writer. It must remain paused for apply and through the
rollback decision, or the preview fingerprint contract cannot protect the run.

Every generated path is resolved from the repo root, never the current working
directory, so the scripts behave identically from a subdirectory:

- `scripts/resort-heroes/preview.json` (gitignored): complete active-row
  snapshot, plan, fingerprints, and render data. Written only after the
  write-blocking assertion passes, so a preview that attempted a write leaves no
  artifact for apply to consume.
- `~/project/.artifact/formoria/resort-heroes-manifests/resort-heroes-live-*.json`:
  flushed restore manifests holding each brand's pre-write `sort_order` values.
  They live beside the review artifact, outside the repo, because they are the
  only rollback path and a gitignored in-repo file does not survive a
  `git clean -xdf`. Apply prints the path at the start of the run, at the end,
  and on failure.
- `scripts/resort-heroes/completed.jsonl` (gitignored): one flushed completion
  record after each brand sync. An operator progress log only — no script reads
  it.

Rollback replays the manifest's `sort_order` values and re-syncs the hero. It
guards on active-set *membership*, not on sort order: after a successful apply the
live sort orders are the new ones, so a sort_order check would refuse every brand
it exists to restore. A brand whose active rows were added or removed since the
manifest is refused and reported instead. Brands are restored with bounded
concurrency, and a brand that fails is reported rather than aborting the restore
of the rest; re-running the same manifest is safe.

Apply is a no-op unless `--live` is supplied. It updates only `sort_order`, syncs
the denormalized hero after each brand, and aborts on invariant or update errors.
Fingerprints are checked twice: an up-front `[PRECHECK SKIP]` pass reports drift
before anything is mutated, and an authoritative re-read immediately before each
brand's own writes decides whether that brand is written (`[SKIP]` on mismatch).
Only the second pass matters for correctness — the first is minutes stale by the
end of a ~844-brand run — so a brand appearing in one and not the other is
expected. Each brand's manifest entry is written and flushed from that fresh
read, before its first update.

Recovery from a failed apply is `rollback`, not a re-run. A re-run is safe
(mutated brands now fail their fingerprint check and skip), but it produces a
second manifest covering only what it touched, so a full restore must replay
every manifest, newest first.
