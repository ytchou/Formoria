"use client";

import { useEffect, useRef } from "react";

/**
 * The form-level error on the four auth screens, announced by moving focus to
 * it.
 *
 * All four screens spelled the same alert block out by hand, which is how the
 * four of them ended up with three different paddings. That is the smaller
 * reason to have this file. The larger one is the announcement ladder: focus
 * move beats `aria-describedby` beats `role="status"` beats `role="alert"`, and
 * every one of these forms sat on the bottom rung.
 *
 * A server action returns its error *after* a submit, by which time focus is
 * still on the submit button and a `role="alert"` fires into a live region the
 * user may have already scrolled past. Moving focus puts the sentence — which
 * always says what to do next, not just what broke — at the caret, and leaves
 * the user one Tab from the field they need to correct.
 *
 * `tabIndex={-1}` makes the container programmatically focusable without adding
 * it to the tab order; the effect keys on `message`, so a second identical
 * failure re-announces rather than sitting silent.
 */
export function AuthFormError({ message }: { message?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);

  if (!message) return null;

  return (
    <div
      className="rounded-surface border border-danger/30 bg-danger/10 px-4 py-3 type-body-sm text-danger outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
      ref={ref}
      role="alert"
      tabIndex={-1}
    >
      {message}
    </div>
  );
}
