import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import {
  getBrandVisitLink,
  type BrandVisitLinkFields,
} from "@/lib/brands/link-fallback";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { sanitizeHref } from "@/lib/url";
import { BrandImageFallback } from "./brand-image-fallback";

/**
 * The link state that suppresses the product-level call-to-action. The value is
 * reported by the service, never filtered on there, so the decision lives here.
 */
const BROKEN_LINK_STATE = "broken";

/**
 * The only `image_usage` value that permits rendering the image. The planner
 * writes `image_url` unconditionally and the applier only declines to MIRROR the
 * file, so a row can carry a live url with usage `none` — the migration defines
 * `none` as "do not render the image", and that decision has to be honoured
 * here. `licensed` gets no special case: whether a licensed image may render is
 * an open policy question, and the fallback tile is the reversible answer.
 */
const RENDERABLE_IMAGE_USAGE = "permitted";

export type BrandSelectedProductsProps = {
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  products: CuratedProduct[];
};

/**
 * Server-only, by design: the whole section is static markup, so the brand page
 * gains a section without gaining a client chunk. Outbound anchors therefore
 * carry their analytics context as data attributes rather than an onClick.
 */
export async function BrandSelectedProducts({
  locale,
  brand,
  products,
}: BrandSelectedProductsProps) {
  if (products.length === 0) return null;

  const t = await getTranslations({
    locale,
    namespace: "brandDetail.selectedProducts",
  });
  const isEnglish = locale === "en";
  const visitLink = getBrandVisitLink(brand);
  const isSingleProduct = products.length === 1;

  // A 40px pill, matching the outbound chips the purchase and social sections
  // already render, so the page keeps one chip shape.
  const chipClassName = buttonVariants({
    variant: "secondary",
    shape: "pill",
    size: "compact",
    className: "mt-auto max-w-full justify-center",
  });

  return (
    <section className="space-y-6" data-brand-selected-products>
      <div className="space-y-2">
        <Typography as="h2" variant="sectionTitle">
          {t("heading")}
        </Typography>
        <Typography as="p" variant="cardDescription">
          {t("note")}
        </Typography>
      </div>

      <ul className="grid list-none grid-cols-1 gap-x-6 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const name =
            (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
          const reason = isEnglish
            ? (product.rationaleEn ?? product.rationaleZh)
            : product.rationaleZh;
          const fact = isEnglish
            ? (product.notesEn ?? product.notesZh)
            : product.notesZh;
          // Usage first, host allowlist second: the allowlist is about where an
          // image may be loaded from, never about whether we are allowed to
          // show it at all.
          const imageSrc =
            product.imageUsage === RENDERABLE_IMAGE_USAGE
              ? safeImageSrc(product.imageUrl)
              : null;
          const productHref = sanitizeHref(product.officialUrl);
          const isBroken = product.linkState === BROKEN_LINK_STATE;
          // A broken product link degrades to the brand's own homepage, never to
          // a product-level call-to-action that would promise a live purchase
          // route we know is down.
          const chipHref = isBroken ? (visitLink?.href ?? null) : productHref;
          const chipLabel = isBroken ? t("brandSiteCta") : t("cta");
          const chipLinkType = isBroken ? "brand_site" : "curated_product";

          return (
            <li
              key={product.key}
              id={`product-${product.key}`}
              className={surfaceCardStyles({
                padding: "none",
                className: `flex flex-col overflow-hidden${
                  isSingleProduct ? " lg:col-span-2 lg:flex-row" : ""
                }`,
              })}
            >
              <div
                className={`relative aspect-[4/3] w-full overflow-hidden bg-muted${
                  isSingleProduct ? " lg:aspect-auto lg:w-1/2" : ""
                }`}
              >
                {imageSrc ? (
                  <Image
                    src={imageSrc}
                    alt={name}
                    fill
                    className="object-cover"
                    sizes={
                      isSingleProduct
                        ? "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 396px"
                        : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    }
                  />
                ) : (
                  <BrandImageFallback
                    name={name}
                    category={product.l1}
                    size="card"
                  />
                )}
              </div>

              <div className="flex flex-1 flex-col gap-2 p-4">
                <Typography as="h3" variant="cardTitle">
                  {name}
                </Typography>

                {/*
                 * Reason above fact, and each badge on its own row beneath the
                 * text it attributes: an inline badge breaks the moment a CJK
                 * line wraps, and the body/metadata contrast is what separates
                 * an editorial pick from a supplied fact without a second hue.
                 */}
                {reason ? (
                  <>
                    <Typography as="p" variant="body">
                      {reason}
                    </Typography>
                    <div>
                      <Badge variant="secondary">{t("selectedBadge")}</Badge>
                    </div>
                  </>
                ) : null}

                {fact ? (
                  <>
                    <Typography as="p" variant="metadata">
                      {fact}
                    </Typography>
                    <div>
                      <Badge variant="declared">
                        {t("brandProvidedBadge")}
                      </Badge>
                    </div>
                  </>
                ) : null}

                {isBroken ? (
                  <Typography as="p" variant="metadata">
                    {t("unavailable")}
                  </Typography>
                ) : null}

                {chipHref ? (
                  <a
                    href={chipHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={chipClassName}
                    data-brand-slug={brand.slug}
                    data-link-type={chipLinkType}
                    data-link-surface="selected_product"
                  >
                    <span className="min-w-0 truncate">{chipLabel}</span>
                    {/*
                     * Every product chip would otherwise announce the same
                     * destination; the product name makes each accessible name
                     * unique without changing the visible label. The leading
                     * ": " matters — screen readers concatenate adjacent inline
                     * spans into one run-together string without it.
                     *
                     * Omitted on the broken branch: that chip goes to the brand
                     * homepage, so naming the product would announce a
                     * destination the link does not have.
                     */}
                    {isBroken ? null : (
                      <span className="sr-only">{`: ${name}`}</span>
                    )}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
