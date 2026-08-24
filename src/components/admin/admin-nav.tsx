"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

export type NavItem = {
  label: string;
  href: string;
  count?: number;
};

type AdminNavProps = {
  items: NavItem[];
};

export function AdminNav({ items }: AdminNavProps) {
  const pathname = usePathname();
  const t = useTranslations("admin.common");

  function isActive(href: string) {
    if (href === routes.admin.index()) return pathname === routes.admin.index();
    return pathname.startsWith(href);
  }

  return (
    <nav
      aria-label={t("navLabel")}
      className="mt-6 overflow-x-auto border-b border-rule"
    >
      <div className="flex min-w-max gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 type-nav hover:text-ink transition-colors transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              isActive(item.href)
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted",
            )}
          >
            {item.label}
            {item.count && item.count > 0 ? (
              <span
                className="rounded-full bg-surface px-2 py-0.5 type-metadata"
                aria-label={t("pendingCount", { count: item.count })}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
