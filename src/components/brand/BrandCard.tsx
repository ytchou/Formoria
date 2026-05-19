"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import type { Brand } from "@/lib/types";

type BrandCardProps = {
  brand: Brand;
};

function BrandLogoFallback({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      aria-hidden="true"
      data-testid="image-fallback"
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-border text-muted-foreground text-lg font-semibold"
    >
      {initials}
    </div>
  );
}

export function BrandCard({ brand }: BrandCardProps) {
  const { name, slug, description, logoUrl, category } = brand;
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/${slug}`}
      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      aria-label={`View ${name}`}
    >
      <Card className="h-full overflow-hidden shadow-[var(--shadow-card)] transition-all duration-200 group-hover:shadow-[var(--shadow-card-hover)] group-hover:-translate-y-px">
        <div className="relative h-40 w-full overflow-hidden rounded-t-[var(--radius)] bg-muted">
          {logoUrl && !imgError ? (
            <Image
              src={logoUrl}
              alt={`${name} logo`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain p-4"
              onError={() => setImgError(true)}
            />
          ) : (
            <BrandLogoFallback name={name} />
          )}
          {category && (
            <span className="absolute left-3 top-3 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-coffee">
              {category}
            </span>
          )}
        </div>

        <CardContent className="p-4">
          <h3 className="font-semibold text-sm truncate" title={name}>
            {name}
          </h3>

          {description && (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
