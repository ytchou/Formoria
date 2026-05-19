import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBrandBySlug } from "@/lib/services/brands";
import { isOwnerOf } from "@/lib/services/brand-owners";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Brand Dashboard | MIT Map",
};

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandDashboardPage({ params }: Props) {
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
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {brand.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your brand listing
          </p>
        </div>
        <Link href={`/dashboard/brands/${slug}/edit`}>
          <Button>Edit Brand</Button>
        </Link>
      </div>

      <div className="mt-8 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Description
              </p>
              <p className="mt-1 text-sm">
                {brand.description ?? "No description yet"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Category
              </p>
              <p className="mt-1 text-sm">
                {brand.category ?? "Uncategorized"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Website
              </p>
              <p className="mt-1 text-sm">
                {brand.socialLinks.officialWebsite ?? "Not set"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Social Links
              </p>
              <div className="mt-1 space-y-1 text-sm">
                {brand.socialLinks.instagram && (
                  <p>Instagram: {brand.socialLinks.instagram}</p>
                )}
                {brand.socialLinks.threads && (
                  <p>Threads: {brand.socialLinks.threads}</p>
                )}
                {brand.socialLinks.facebook && (
                  <p>Facebook: {brand.socialLinks.facebook}</p>
                )}
                {!brand.socialLinks.instagram &&
                  !brand.socialLinks.threads &&
                  !brand.socialLinks.facebook && <p>None set</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Public Page
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/brands/${slug}`}
              className="text-sm text-primary hover:underline"
            >
              View your brand on MIT Map
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
