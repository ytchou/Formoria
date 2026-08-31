import { getTranslations } from "next-intl/server";
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
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "var(--ground)",
        color: "var(--ink)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "420px",
          textAlign: "center",
          padding: "32px",
          border: "1px solid var(--rule)",
          borderRadius: "8px",
          background: "var(--surface)",
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: "24px", lineHeight: 1.25 }}>
          {t("title")}
        </h1>
        <p
          style={{
            margin: "0 0 24px",
            color: "var(--ink-muted)",
            lineHeight: 1.5,
          }}
        >
          {t("description")}
        </p>
        <ChallengeWidget
          returnTo={returnTo}
          verifyingLabel={t("verifying")}
          errorLabel={t("error")}
        />
      </section>
    </main>
  );
}
