import type { AppLocale } from "@/i18n/locale-preference";
import {
  getBrandVisitLink,
  type BrandVisitLinkFields,
} from "@/lib/brands/link-fallback";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { subcategoryDisplayLabel } from "@/lib/taxonomy/ontology";
import { sanitizeHref } from "@/lib/url";

/**
 * Exactly the product fields a tile reads, in ANY mode. Narrower than
 * `CuratedProduct` so a client-fetched homepage group (DEV-1972) can ship a
 * projection instead of the whole row; every `CuratedProduct` still fits.
 * Add a field here when a tile starts reading it.
 */
export type SelectedProductTileProduct = Pick<
  CuratedProduct,
  | "id"
  | "key"
  | "nameZh"
  | "nameEn"
  | "productDescriptionZh"
  | "productDescriptionEn"
  | "imageUrl"
  | "subcategory"
  | "category"
  | "linkState"
  | "officialUrl"
  | "mitQualified"
>;

export type SelectedProductTileLabels = {
  cta: string;
  brandSiteCta: string;
  unavailable: string;
  madeInTaiwan?: string;
  /** Screen-reader lead-in for the shelf's guide link (guide). */
  inGuide?: string;
};

/** The brand-page fields a tile's outbound link falls back to. */
export type TileBrand = BrandVisitLinkFields & { slug: string; id?: string };

type OutboundLinkType = "curated_product" | "brand_site";

export type TileFields = {
  name: string;
  /** WCAG 3.1.2: an EN page showing the zh fallback marks that part as zh. */
  nameLang: "zh-Hant-TW" | undefined;
  /** Rendered only when non-empty. */
  description: string;
  descriptionLang: "zh-Hant-TW" | undefined;
  imageSrc: string | null;
  isBroken: boolean;
  subcategoryName: string | null;
  /** The outbound link: the product page, or the brand site when it is broken. */
  chip: { href: string | null; label: string; linkType: OutboundLinkType };
};

const BROKEN_LINK_STATE = "broken";
const ZH_FALLBACK_LANG = "zh-Hant-TW";

/** The per-product values every tile mode derives the same way. */
export function tileFields(
  product: SelectedProductTileProduct,
  locale: AppLocale,
  labels: Pick<SelectedProductTileLabels, "cta" | "brandSiteCta">,
  brand?: BrandVisitLinkFields,
): TileFields {
  const isEnglish = locale === "en";
  const name = (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  /*
   * ONE text block per tile (DEV-1496). The three fields this replaced — a
   * selection rationale, a brand-page highlight rationale and a brand-supplied
   * note — collapsed into `product_description`, so there is nothing left to
   * choose between and no second badge to attach to a second block.
   *
   * `_zh` is the fallback because it is the NOT NULL column: an EN reader with
   * no English twin gets the Chinese text, never an empty block.
   */
  const description = isEnglish
    ? (product.productDescriptionEn ?? product.productDescriptionZh)
    : product.productDescriptionZh;
  const isBroken = product.linkState === BROKEN_LINK_STATE;
  const visitHref = brand ? (getBrandVisitLink(brand)?.href ?? null) : null;
  return {
    name,
    nameLang: isEnglish && !product.nameEn ? ZH_FALLBACK_LANG : undefined,
    description,
    descriptionLang:
      isEnglish && !product.productDescriptionEn && product.productDescriptionZh
        ? ZH_FALLBACK_LANG
        : undefined,
    imageSrc: safeImageSrc(product.imageUrl),
    isBroken,
    subcategoryName: product.subcategory
      ? subcategoryDisplayLabel(product.subcategory, locale)
      : null,
    chip: {
      href: isBroken ? visitHref : sanitizeHref(product.officialUrl),
      label: isBroken ? labels.brandSiteCta : labels.cta,
      linkType: isBroken ? "brand_site" : "curated_product",
    },
  };
}
