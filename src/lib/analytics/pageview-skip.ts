// One-shot suppression of the next GA page_view. Set by a client component that
// rewrites the URL with history.replaceState after the server render (e.g. writing
// inferred filters into /discover), so that rewrite is not counted as a second
// page view. Module-level is safe: both the setter and the GA effect are client-side
// singletons. The flag is cleared on consume and never expires on a timer.
let skipPending = false

export function skipNextPageview(): void {
  skipPending = true
}

export function consumePageviewSkip(): boolean {
  const pending = skipPending
  skipPending = false
  return pending
}
