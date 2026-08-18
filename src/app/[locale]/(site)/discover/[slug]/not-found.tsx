// Client on purpose. Next renders this boundary as part of the segment's static
// shell, so a server-side next-intl call here resolves the locale through
// `headers()` and throws DYNAMIC_SERVER_USAGE on this route's on-demand ISR
// render (DEV-1493).
"use client";

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/ui/empty-state";
import { Link } from "@/i18n/navigation";

export default function DiscoverTrailNotFound() {
  const t = useTranslations("discover");
  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <EmptyState
        icon={<Compass />}
        title={t("notFound.title")}
        body={t("notFound.description")}
        action={
          <Link
            href="/discover"
            className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 type-button text-primary-foreground"
          >
            {t("notFound.browseAll")}
          </Link>
        }
      />
    </main>
  );
}
