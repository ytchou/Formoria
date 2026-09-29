import { Link } from "@/i18n/navigation";
import { BrandAvatar } from "@/components/brands/brand-avatar";
import { DiscoverBrandRowClickTracker } from "@/components/analytics/discover-brand-row-click-tracker";
import type { BrandNameMatch } from "@/lib/brands/brand-name-match";
import { routes } from "@/lib/routes";

export function DiscoverBrandRow({
  brands,
  heading,
  query,
  searchId,
}: {
  brands: BrandNameMatch[];
  heading: string;
  query: string;
  searchId: string;
}) {
  if (!brands.length) return null;
  return (
    <section className="mb-8 space-y-6" aria-label={heading}>
      <h2 className="type-card-title">{heading}</h2>
      <DiscoverBrandRowClickTracker query={query} searchId={searchId}>
        <ul className="grid grid-cols-3 gap-6 sm:grid-cols-6">
          {brands.map((brand) => (
            <li key={brand.id} data-brand-slug={brand.slug}>
              <Link
                href={routes.brand(brand.slug)}
                className="flex flex-col items-center rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
              >
                <BrandAvatar
                  name={brand.name}
                  imageSrc={brand.heroImageUrl}
                  nameFace="content"
                />
              </Link>
            </li>
          ))}
        </ul>
      </DiscoverBrandRowClickTracker>
    </section>
  );
}
