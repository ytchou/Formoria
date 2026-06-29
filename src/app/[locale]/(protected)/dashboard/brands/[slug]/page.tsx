import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ slug: string; locale: string }>;
};

// Brand management now lives inline on /dashboard. Keep this route as a
// redirect so existing links/bookmarks resolve to the right brand.
export default async function BrandDashboardPage({ params }: Props) {
  const { slug } = await params;
  redirect(`/dashboard?brand=${slug}`);
}
