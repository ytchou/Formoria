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
      className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-lg font-semibold"
    >
      {initials}
    </div>
  );
}

export function BrandCard({ brand }: BrandCardProps) {
  const { name, slug, description, logoUrl, category } = brand;

  return (
    <Link
      href={`/${slug}`}
      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      aria-label={`View ${name}`}
    >
      <Card className="h-full overflow-hidden transition-shadow duration-200 group-hover:shadow-md">
        <div className="relative h-40 w-full overflow-hidden bg-muted">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`${name} logo`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain p-4"
            />
          ) : (
            <BrandLogoFallback name={name} />
          )}
        </div>

        <CardContent className="p-4">
          <h3 className="font-semibold text-sm truncate" title={name}>
            {name}
          </h3>

          {category && (
            <span className="mt-1.5 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
              {category}
            </span>
          )}

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
