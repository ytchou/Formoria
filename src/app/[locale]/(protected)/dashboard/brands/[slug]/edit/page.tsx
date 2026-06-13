import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { canManageBrand } from "@/lib/auth/admin-mode";
import { getBrandBySlug, getBrandDraft } from "@/lib/services/brands";
import { DraftBanner } from "../draft-banner";
import { BrandEditForm } from "./brand-edit-form";

type Props = {
  params: Promise<{ slug: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard.edit" });
  return { title: t("metaTitle") };
}

export default async function BrandEditPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const brand = await getBrandBySlug(slug);
  const owner = await canManageBrand(user.id, user.email, brand.id);

  if (!owner) redirect("/dashboard");

  const draft = await getBrandDraft(brand.id);
  const t = await getTranslations("dashboard.edit");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-heading text-2xl font-bold tracking-tight">
        {t("pageHeading", { name: brand.name })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("pageSubheading")}
      </p>

      <div className="mt-8">
        {draft ? (
          <div className="mb-8">
            <DraftBanner slug={brand.slug} draftUpdatedAt={null} />
          </div>
        ) : null}
        <BrandEditForm brand={brand} />
      </div>
    </div>
  );
}
