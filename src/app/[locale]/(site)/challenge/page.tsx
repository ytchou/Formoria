import { getTranslations } from "next-intl/server";
import { SurfaceCard } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { ChallengeWidget } from "./challenge-widget";

type ChallengePageProps = {
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

export default async function ChallengePage({
  searchParams,
}: ChallengePageProps) {
  const [t, query] = await Promise.all([
    getTranslations("challenge"),
    searchParams,
  ]);
  const returnTo = typeof query.returnTo === "string" ? query.returnTo : "/";

  return (
    <PageShell
      as="main"
      measure="form"
      className="flex flex-col items-center py-section"
    >
      <SurfaceCard padding="lg" className="w-full content-column text-center">
        <h1 className="type-page-title">{t("title")}</h1>
        <p className="mt-3 type-body-sm text-ink-muted">{t("description")}</p>
        <div className="mt-6">
          <ChallengeWidget
            returnTo={returnTo}
            verifyingLabel={t("verifying")}
            errorLabel={t("error")}
          />
        </div>
      </SurfaceCard>
    </PageShell>
  );
}
