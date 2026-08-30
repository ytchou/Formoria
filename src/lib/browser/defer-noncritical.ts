const NONCRITICAL_DELAY_MS = 10_000

/** Load non-critical browser work after intent, with a bounded fallback. */
export function deferNoncritical(callback: () => void): () => void {
  let pending = true

  const run = () => {
    if (!pending) return
    pending = false
    window.clearTimeout(timer)
    window.removeEventListener('pointerdown', run)
    window.removeEventListener('keydown', run)
    callback()
  }

  const timer = window.setTimeout(run, NONCRITICAL_DELAY_MS)
  window.addEventListener('pointerdown', run, { passive: true, once: true })
  window.addEventListener('keydown', run, { once: true })

  return () => {
    if (!pending) return
    pending = false
    window.clearTimeout(timer)
    window.removeEventListener('pointerdown', run)
    window.removeEventListener('keydown', run)
  }
}
