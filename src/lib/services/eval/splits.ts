/**
 * Seeded, stratified 60/20/20 golden-set splits (DEV-1896, shared by DEV-1898
 * D9a/D21). Pure: no I/O. `harvest-name-arbiter-golden` and
 * `llm-eval dataset split` both deal splits through `assignSplits`.
 */
import { createHash } from 'node:crypto'

export const SPLITS = ['train', 'val', 'holdout'] as const
export type Split = (typeof SPLITS)[number]

/** 60/20/20: every five positions in the stratum-ordered list hold 3 train, 1 val, 1 holdout. */
const SPLIT_PATTERN: readonly Split[] = ['train', 'train', 'train', 'val', 'holdout']

function seededKey(seed: string, id: string): string {
  return createHash('sha256').update(`${seed}:${id}`).digest('hex')
}

export type SplitItem = { id: string; split?: Split }

export type AssignSplitsOptions<T extends SplitItem> = {
  seed: string
  /** The stratum an item is dealt in; a set without a label passes one constant stratum. */
  strataOf: (item: T) => string
  /** Ids that always go to train (e.g. items quoted in a prompt). */
  pinnedToTrain: ReadonlySet<string>
}

/**
 * Pinned items go to train. Unpinned items that already carry a split keep it,
 * so a re-run never moves an item between splits. The rest are grouped by
 * `strataOf`, ordered by a seeded hash within each group, and dealt
 * round-robin through the 3/1/1 pattern over the concatenated stratum-ordered
 * list. The position starts at the count of unpinned items that already have
 * a split, so an incremental run continues the pattern instead of restarting
 * at train. Each stratum lands within +-1 item per split of 60/20/20 (a small
 * stratum can get no train item), and the result does not depend on input order.
 */
export function assignSplits<T extends SplitItem>(items: readonly T[], options: AssignSplitsOptions<T>): T[] {
  const { seed, strataOf, pinnedToTrain } = options
  const strata = new Map<string, T[]>()
  for (const item of items) {
    if (pinnedToTrain.has(item.id) || item.split) continue
    const key = strataOf(item)
    strata.set(key, [...(strata.get(key) ?? []), item])
  }

  const assigned = new Map<string, Split>()
  let position = items.filter((item) => !pinnedToTrain.has(item.id) && item.split).length
  for (const key of [...strata.keys()].sort()) {
    const ordered = strata
      .get(key)!
      .map((item) => ({ item, hash: seededKey(seed, item.id) }))
      .sort((a, b) => a.hash.localeCompare(b.hash))
    for (const { item } of ordered) {
      assigned.set(item.id, SPLIT_PATTERN[position % SPLIT_PATTERN.length]!)
      position++
    }
  }

  return items.map((item) => ({
    ...item,
    split: pinnedToTrain.has(item.id) ? 'train' : (item.split ?? assigned.get(item.id)),
  }))
}
