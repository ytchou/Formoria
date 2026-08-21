"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";

export default function DiscoverTrailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("discover");
  return (
    // `prose`, as at every error boundary: one centred line and a retry.
    <PageShell
      as="main"
      measure="prose"
      className="flex min-h-[40vh] items-center justify-center py-10"
    >
      <div role="alert" className="space-y-4 text-center">
        <p className="type-card-title text-ink-muted">{t("loadError")}</p>
        <Button
          type="button"
          variant="secondary"
          className="min-h-12"
          onClick={() => reset()}
        >
          {t("retry")}
        </Button>
      </div>
    </PageShell>
  );
}
