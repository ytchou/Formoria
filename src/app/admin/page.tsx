import type { Metadata } from "next";
import Link from "next/link";
import { getSubmissions } from "@/lib/services/submissions";
import { getBrands } from "@/lib/services/brands";
import { getTags } from "@/lib/services/taxonomy";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Admin | MIT Map",
};

export default async function AdminPage() {
  const [pendingSubmissions, { totalCount: brandCount }, tags] =
    await Promise.all([
      getSubmissions("pending"),
      getBrands(),
      getTags(),
    ]);

  const stats = [
    {
      label: "Pending Submissions",
      count: pendingSubmissions.length,
      href: "/admin/submissions",
    },
    {
      label: "Total Brands",
      count: brandCount,
      href: "/admin/brands",
    },
    {
      label: "Active Tags",
      count: tags.length,
      href: "/admin/taxonomy",
    },
  ];

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Admin Dashboard
      </h1>
      <p className="mt-2 text-[#7C7570]">
        Manage brands, submissions, and site settings.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.href} href={stat.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-[#7C7570]">
                  {stat.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-heading text-4xl font-bold">{stat.count}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
