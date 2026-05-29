import type { Metadata } from "next";
import Link from "next/link";
import { getSubmissions } from "@/lib/services/submissions";
import { getBrands } from "@/lib/services/brands";
import { getTags } from "@/lib/services/taxonomy";
import { getPendingReports } from "@/lib/services/reports";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "管理後台 | MIT Map",
};

export default async function AdminPage() {
  const [pendingSubmissions, { totalCount: brandCount }, tags, pendingReports] =
    await Promise.all([
      getSubmissions("pending"),
      getBrands(),
      getTags(),
      getPendingReports().catch(() => [] as Awaited<ReturnType<typeof getPendingReports>>),
    ]);

  const stats = [
    {
      label: "待審核提交",
      count: pendingSubmissions.length,
      href: "/admin/submissions",
    },
    {
      label: "品牌總數",
      count: brandCount,
      href: "/admin/brands",
    },
    {
      label: "啟用標籤",
      count: tags.length,
      href: "/admin/taxonomy",
    },
    {
      label: "待審核檢舉",
      count: pendingReports.length,
      href: "/admin/reports",
    },
  ];

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        管理後台
      </h1>
      <p className="mt-2 text-[#7C7570]">
        管理品牌、提交記錄和站台設定。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-4">
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
