// Client on purpose. Next renders this boundary as part of the segment's static
// shell, so a server-side next-intl call here resolves the locale through
// `headers()` and throws DYNAMIC_SERVER_USAGE on this route's on-demand ISR
// render (DEV-1493).
"use client";

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";

export default function StyleTrailNotFound() {
  const t = useTranslations("style");
  return (
    // `prose`, as at every error boundary: the empty state is one centred
    // message, and the trail's own 100rem shell would strand it in whitespace.
    <PageShell as="main" measure="prose" className="py-10">
      <EmptyState
        icon={<Compass />}
        title={t("notFound.title")}
        body={t("notFound.description")}
        action={
          <Link
            href={routes.style()}
            className={buttonVariants({ variant: "primary", size: "large" })}
          >
            {t("notFound.browseAll")}
          </Link>
        }
      />
    </PageShell>
  );
}
