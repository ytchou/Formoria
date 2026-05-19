import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBrandBySlug } from "@/lib/services/brands";
import { isOwnerOf } from "@/lib/services/brand-owners";
import { BrandEditForm } from "./brand-edit-form";

export const metadata: Metadata = {
  title: "Edit Brand | MIT Map",
};

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandEditPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const brand = await getBrandBySlug(slug);
  const owner = await isOwnerOf(user.id, brand.id);

  if (!owner) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-heading text-2xl font-bold tracking-tight">
        Edit {brand.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Update your brand listing details
      </p>

      <div className="mt-8">
        <BrandEditForm
          brandSlug={brand.slug}
          defaultValues={{
            name: brand.name,
            description: brand.description ?? "",
            websiteUrl: brand.socialLinks.officialWebsite ?? "",
            instagram: brand.socialLinks.instagram ?? "",
            threads: brand.socialLinks.threads ?? "",
            facebook: brand.socialLinks.facebook ?? "",
          }}
        />
      </div>
    </div>
  );
}
