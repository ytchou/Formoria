/**
 * Prompt sync module — pull/push/promote logic for Langfuse canonical prompts.
 *
 * Pure functions, no I/O. The CLI wires in the real Langfuse API and filesystem.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotFile = {
  prompts: Record<string, { version: number; text: string[] }>
}

export type PromptApi = {
  promptsGet(q: {
    promptName: string
    label?: string
    version?: number
  }): Promise<{ version: number; prompt: unknown; labels?: string[] }>
  promptsCreate(b: {
    name: string
    prompt: string
    type: 'text'
    labels: string[]
  }): Promise<{ name: string; version: number }>
  promptVersionUpdate(
    name: string,
    version: number,
    b: { newLabels: string[] },
  ): Promise<unknown>
}

// ---------------------------------------------------------------------------
// Placeholder utilities
// ---------------------------------------------------------------------------

/** Same regex as `src/lib/langfuse/prompt.ts` — no spaces inside delimiters. */
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

/** Extract unique `{{key}}` placeholder names from a template string. */
export function placeholderSet(text: string): Set<string> {
  const keys = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    keys.add(m[1]!)
  }
  return keys
}

/**
 * Assert that two texts use the same set of `{{key}}` placeholders.
 * Throws listing `+added` and `-removed` keys when they differ.
 */
export function assertPlaceholderParity(
  newText: string,
  snapshotText: string,
  opts?: { allow: boolean },
): void {
  if (opts?.allow) return

  const newKeys = placeholderSet(newText)
  const oldKeys = placeholderSet(snapshotText)

  const added = [...newKeys].filter((k) => !oldKeys.has(k))
  const removed = [...oldKeys].filter((k) => !newKeys.has(k))

  if (added.length === 0 && removed.length === 0) return

  const parts: string[] = []
  if (added.length > 0) parts.push(added.map((k) => `+${k}`).join(', '))
  if (removed.length > 0) parts.push(removed.map((k) => `-${k}`).join(', '))
  throw new Error(`Placeholder change: ${parts.join('; ')}`)
}

// ---------------------------------------------------------------------------
// Inlined-block detection
// ---------------------------------------------------------------------------

/**
 * Assert that a prompt text does not contain any raw block literal values.
 * Blocks should be interpolated via `{{key}}` placeholders, not inlined.
 *
 * @param blocks - Map of placeholder name → literal string that should NOT appear.
 */
export function assertNoInlinedBlocks(
  text: string,
  blocks: Record<string, string>,
): void {
  for (const [name, literal] of Object.entries(blocks)) {
    if (text.includes(literal)) {
      throw new Error(
        `Prompt contains inlined block "${name}" — use {{${name}}} placeholder instead`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Text codec — lines ↔ string
// ---------------------------------------------------------------------------

/** Split a string into lines (preserving trailing newline as empty final element). */
export function textToLines(text: string): string[] {
  // Split on newline boundaries. A trailing newline produces an empty final element,
  // which linesToText restores faithfully.
  return text.split('\n')
}

/** Join lines back into a string. Inverse of textToLines. */
export function linesToText(lines: string[]): string {
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Pull snapshot
// ---------------------------------------------------------------------------

type PullOptions = {
  api: PromptApi
  snapshot: SnapshotFile
  knownNames: string[]
  remoteNames: string[]
  add?: string[]
  check?: boolean
  allowVariableChange?: boolean
  warn?: (msg: string) => void
}

type DriftEntry = { name: string; snapshotVersion: number; remoteVersion: number }
type PlaceholderDriftEntry = { name: string; added: string[]; removed: string[] }

type PullResult = {
  ok: boolean
  snapshot?: SnapshotFile
  drift?: DriftEntry[]
  unknownRemote?: string[]
  rejected?: string[]
  placeholderDrift?: PlaceholderDriftEntry[]
}

export async function pullSnapshot(opts: PullOptions): Promise<PullResult> {
  const {
    api,
    snapshot,
    knownNames,
    remoteNames,
    add = [],
    check = false,
    allowVariableChange = false,
    warn,
  } = opts

  // Warn on unknown remote names
  const knownSet = new Set([...knownNames, ...add])
  const unknownRemote = remoteNames.filter((n) => !knownSet.has(n))
  for (const name of unknownRemote) {
    warn?.(`Unknown remote prompt: ${name}`)
  }

  // Determine names to pull
  const namesToPull = [...knownNames, ...add]

  // Handle --add names that have no production label
  const rejected: string[] = []
  const placeholderDrift: PlaceholderDriftEntry[] = []

  const newPrompts: Record<string, { version: number; text: string[] }> = {}

  for (const name of namesToPull) {
    try {
      const remote = await api.promptsGet({ promptName: name, label: 'production' })

      if (typeof remote.prompt !== 'string') {
        throw new Error(`Prompt "${name}" is not a text prompt`)
      }

      const remoteText = remote.prompt
      const remoteLines = textToLines(remoteText)

      // Check placeholder parity against existing snapshot entry
      const existing = snapshot.prompts[name]
      if (existing && !allowVariableChange) {
        const existingText = linesToText(existing.text)
        const newKeys = placeholderSet(remoteText)
        const oldKeys = placeholderSet(existingText)
        const added = [...newKeys].filter((k) => !oldKeys.has(k))
        const removed = [...oldKeys].filter((k) => !newKeys.has(k))

        if (added.length > 0 || removed.length > 0) {
          placeholderDrift.push({ name, added, removed })
          continue
        }
      }

      newPrompts[name] = { version: remote.version, text: remoteLines }
    } catch {
      if (add.includes(name)) {
        rejected.push(name)
      }
    }
  }

  if (rejected.length > 0) {
    return { ok: false, rejected }
  }

  if (placeholderDrift.length > 0) {
    return { ok: false, placeholderDrift }
  }

  // Check mode: report version drift without writing
  if (check) {
    const drift: DriftEntry[] = []
    for (const name of knownNames) {
      const existing = snapshot.prompts[name]
      const pulled = newPrompts[name]
      if (existing && pulled && existing.version !== pulled.version) {
        drift.push({
          name,
          snapshotVersion: existing.version,
          remoteVersion: pulled.version,
        })
      }
    }

    if (drift.length > 0) {
      return { ok: false, drift }
    }
    return { ok: true }
  }

  // Build updated snapshot
  const updatedPrompts = { ...snapshot.prompts }
  for (const [name, entry] of Object.entries(newPrompts)) {
    updatedPrompts[name] = entry
  }

  return {
    ok: true,
    snapshot: { prompts: updatedPrompts },
    unknownRemote: unknownRemote.length > 0 ? unknownRemote : undefined,
  }
}

// ---------------------------------------------------------------------------
// Push prompt
// ---------------------------------------------------------------------------

type PushOptions = {
  api: PromptApi
  name: string
  text?: string
  snapshot?: SnapshotFile
  label?: string
}

type PushResult = {
  skipped: boolean
  name?: string
  version?: number
}

export async function pushPrompt(opts: PushOptions): Promise<PushResult> {
  const { api, name, label } = opts

  // Resolve text: explicit > snapshot entry
  let text = opts.text
  if (text === undefined && opts.snapshot) {
    const entry = opts.snapshot.prompts[name]
    if (!entry) {
      throw new Error(`No snapshot entry for "${name}"`)
    }
    text = linesToText(entry.text)
  }
  if (text === undefined) {
    throw new Error(`No text provided and no snapshot entry for "${name}"`)
  }

  // Compare against latest
  try {
    const latest = await api.promptsGet({ promptName: name, label: 'latest' })
    if (typeof latest.prompt === 'string' && latest.prompt === text) {
      return { skipped: true }
    }
  } catch {
    // No existing prompt — proceed to create
  }

  const labels = label ? [label] : []
  const result = await api.promptsCreate({
    name,
    prompt: text,
    type: 'text',
    labels,
  })

  return { skipped: false, name: result.name, version: result.version }
}

// ---------------------------------------------------------------------------
// Promote prompt
// ---------------------------------------------------------------------------

type PromoteOptions = {
  api: PromptApi
  name: string
  version: number
  snapshot: SnapshotFile
  knownNames: string[]
}

type PromoteResult = {
  ok: boolean
  error?: string
  snapshot?: SnapshotFile
}

export async function promotePrompt(opts: PromoteOptions): Promise<PromoteResult> {
  const { api, name, version, snapshot, knownNames } = opts

  // Fetch the version's text to check placeholder parity
  const remote = await api.promptsGet({ promptName: name, version })
  if (typeof remote.prompt !== 'string') {
    return { ok: false, error: `Prompt "${name}" v${version} is not a text prompt` }
  }

  // Check parity against snapshot
  const existing = snapshot.prompts[name]
  if (existing) {
    const existingText = linesToText(existing.text)
    const newKeys = placeholderSet(remote.prompt)
    const oldKeys = placeholderSet(existingText)
    const added = [...newKeys].filter((k) => !oldKeys.has(k))
    const removed = [...oldKeys].filter((k) => !newKeys.has(k))

    if (added.length > 0 || removed.length > 0) {
      const parts: string[] = []
      if (added.length > 0) parts.push(added.map((k) => `+${k}`).join(', '))
      if (removed.length > 0) parts.push(removed.map((k) => `-${k}`).join(', '))
      return { ok: false, error: `Placeholder change: ${parts.join('; ')}` }
    }
  }

  // Label the version as production
  await api.promptVersionUpdate(name, version, { newLabels: ['production'] })

  // Pull the newly promoted version into the snapshot
  const pullResult = await pullSnapshot({
    api,
    snapshot,
    knownNames,
    remoteNames: knownNames,
  })

  return {
    ok: true,
    snapshot: pullResult.snapshot,
  }
}
