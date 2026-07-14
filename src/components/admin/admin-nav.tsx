"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  return (
    <nav
      aria-label="Admin main navigation"
      className="mt-6 overflow-x-auto border-b border-border"
    >
      <div className="flex min-w-max gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 type-nav-item transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive(item.href)
                ? "border-cta text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {item.label}
            {item.count && item.count > 0 ? (
              <span
                className="rounded-full bg-muted px-2 py-0.5 type-caption"
                aria-label={`${item.count} pending`}
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
