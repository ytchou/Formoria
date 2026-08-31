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
      <div
        style={{ display: "flex", justifyContent: "center", minHeight: "65px" }}
      >
        <TurnstileWidget
          key={widgetKey}
          onSuccess={handleSuccess}
          onError={() => setState("error")}
        />
      </div>
      {state === "verifying" ? (
        <p style={{ margin: "20px 0 0", color: "var(--ink-muted)" }}>
          {verifyingLabel}
        </p>
      ) : null}
      {state === "error" ? (
        <p style={{ margin: "20px 0 0", color: "var(--danger)" }}>
          {errorLabel}
        </p>
      ) : null}
    </>
  );
}
