"use client";

import { useCallback, useState } from "react";
import { TurnstileWidget } from "@/components/submit/TurnstileWidget";

type ChallengeState = "idle" | "verifying" | "error";

const CHALLENGE_VERIFY_TIMEOUT_MS = 15_000;

export function ChallengeWidget({
  returnTo,
  verifyingLabel,
  errorLabel,
}: {
  returnTo: string;
  verifyingLabel: string;
  errorLabel: string;
}) {
  const [state, setState] = useState<ChallengeState>("idle");
  const [widgetKey, setWidgetKey] = useState(0);

  const handleVerificationFailure = useCallback(() => {
    setState("error");
    setWidgetKey((current) => current + 1);
  }, []);

  const handleSuccess = useCallback(
    async (token: string) => {
      setState("verifying");

      try {
        const response = await fetch("/api/challenge/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token, returnTo }),
          signal: AbortSignal.timeout(CHALLENGE_VERIFY_TIMEOUT_MS),
        });

        if (!response.ok) {
          handleVerificationFailure();
          return;
        }

        const data = (await response.json()) as { redirectTo?: string };
        window.location.href = data.redirectTo ?? "/";
      } catch {
        handleVerificationFailure();
      }
    },
    [handleVerificationFailure, returnTo],
  );

  return (
    <>
      {/* 65px is Turnstile's own widget height; reserving it stops the card
          jumping when the iframe mounts. */}
      <div className="flex min-h-[65px] justify-center">
        <TurnstileWidget
          key={widgetKey}
          onSuccess={handleSuccess}
          onError={() => setState("error")}
        />
      </div>
      {state === "verifying" ? (
        <p role="status" className="mt-4 type-body-sm text-ink-muted">
          {verifyingLabel}
        </p>
      ) : null}
      {/* The error survives the re-key below on purpose: it clears only when
          the next attempt starts (handleSuccess sets "verifying"), so the
          alert is not withdrawn before it is read. */}
      {state === "error" ? (
        <p role="alert" className="mt-4 type-body-sm text-danger">
          {errorLabel}
        </p>
      ) : null}
    </>
  );
}
