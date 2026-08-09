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

Generated files are local and ignored:

- `preview.json`: complete active-row snapshot, plan, fingerprints, and render data.
- `manifests/resort-heroes-live-*.json`: flushed restore manifests containing only old sort orders and hero URLs.
- `completed.jsonl`: one flushed completion record after each brand sync.

Rollback replays the manifest's `sort_order` values and re-syncs the hero. It
guards on active-set *membership*, not on sort order: after a successful apply the
live sort orders are the new ones, so a sort_order check would refuse every brand
it exists to restore. A brand whose active rows were added or removed since the
manifest is refused and reported instead.

Apply is a no-op unless `--live` is supplied. It rechecks every fingerprint,
writes the manifest before the first mutation, updates only `sort_order`, syncs
the denormalized hero after each brand, and aborts on invariant or update errors.
