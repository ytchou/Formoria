"use client";

import { useEffect, useRef } from "react";

/** Focus the completed attempt's error, including an unchanged message. */
export function AuthFormError({
  message,
  pending,
}: {
  message?: string;
  pending: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message && !pending) ref.current?.focus();
  }, [message, pending]);

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
