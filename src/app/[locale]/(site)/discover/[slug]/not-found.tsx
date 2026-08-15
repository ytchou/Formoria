import { Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { Link } from "@/i18n/navigation";

export default async function DiscoverTrailNotFound() {
  const t = await getTranslations("discover");
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
