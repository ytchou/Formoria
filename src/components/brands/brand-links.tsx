"use client";

import { useTranslations } from "next-intl";
import {
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from "@/lib/url";
import { useState, type ReactNode } from "react";
import {
  AtSign,
  Globe,
  Link,
  Package,
  ShoppingCart,
  Store,
} from "lucide-react";
import { InstagramIcon } from "@/components/icons/instagram-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Typography } from "@/components/ui/typography";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import {
  onlineStoreMessageKey,
  ONLINE_STORES,
  type OnlineStoreColumn,
  type OnlineStoreKey,
} from "@/lib/brands/online-stores";
import { trackExternalLinkClicked } from "@/lib/analytics";
import { CorrectionDialog } from "./correction-dialog";
import { ProvideStockistInfoDialog } from "./provide-stockist-info-dialog";

interface BrandLinksProps {
  brand: PublicBrandDetail;
  sectionIds?: {
    social?: string;
    purchase?: string;
  };
  sectionClassName?: string;
}

function normalizeDirectUrl(value: string | undefined | null): string | null {
  return sanitizeHref(value);
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M14 8h3V4h-3c-3.31 0-5 1.96-5 5v2H6v4h3v7h4v-7h3.24L17 11h-4V9c0-.68.32-1 1-1z" />
    </svg>
  );
}

type LinkDestination =
  OnlineStoreKey | "instagram" | "threads" | "facebook";

type LinkSlot = {
  label: string;
  url: string;
  linkType: LinkDestination | "other";
  icon: ReactNode;
};

/** A destination before we know whether we hold a URL for it. */
type LinkCandidate = Omit<LinkSlot, "url"> & { url: string | null };

type LinkSectionProps = {
  id?: string;
  label: string;
  /** h2 for a standalone section; h3 when it sits under where-to-buy's h2. */
  headingLevel?: "h2" | "h3";
  /** Only known destinations: a slot without a URL never reaches here. */
  slots: LinkSlot[];
  brand: PublicBrandDetail;
  className?: string;
  /** One muted line below the links; a section with a note always renders. */
  note?: string | null;
};

const destinationLinkClassName = buttonVariants({
  variant: "secondary",
  shape: "pill",
  size: "compact",
  className: "min-w-32 max-w-full justify-center gap-2",
});

// Icons are ink (`text-current`): DESIGN.md §2 allows no palette exceptions,
// platform brand colours included.
const PURCHASE_PRESENTATION = {
  website: { icon: <Globe className="size-4 text-current" /> },
  pinkoi: { icon: <Store className="size-4 text-current" /> },
  shopee: { icon: <ShoppingCart className="size-4 text-current" /> },
  myship: { icon: <Package className="size-4 text-current" /> },
} satisfies Record<OnlineStoreKey, { icon: ReactNode }>;

function DestinationLinkButton({
  slot,
  children,
}: {
  slot: LinkSlot;
  children: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center"
      >
        {slot.icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
}

function SectionLabel({
  as,
  children,
}: {
  as: "h2" | "h3";
  children: ReactNode;
}) {
  return (
    <Typography
      as={as}
      variant={as === "h2" ? "sectionTitleLarge" : "cardTitle"}
    >
      {children}
    </Typography>
  );
}

function LinkSection({
  id,
  label,
  headingLevel = "h2",
  slots,
  brand,
  className,
  note,
}: LinkSectionProps) {
  if (slots.length === 0 && !note) return null;

  return (
    <section id={id} className={className}>
      <div className="mb-4">
        <SectionLabel as={headingLevel}>{label}</SectionLabel>
      </div>
      {slots.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {slots.map((slot, index) => {
            const slotKey = `${slot.linkType}:${slot.label}:${index}`;

            return (
              <a
                key={slotKey}
                href={slot.url}
                target="_blank"
                rel="noopener noreferrer"
                className={destinationLinkClassName}
                data-ph-no-autocapture
                onClick={() => {
                  trackExternalLinkClicked(
                    brand.slug,
                    slot.linkType,
                    typeof window !== "undefined"
                      ? window.location.pathname
                      : "",
                    "detail_page",
                    brand.id,
                  );
                }}
              >
                <DestinationLinkButton slot={slot}>
                  {slot.label}
                </DestinationLinkButton>
              </a>
            );
          })}
        </div>
      ) : null}
      {note ? (
        <p className={slots.length > 0 ? "mt-3 type-metadata" : "type-metadata"}>
          {note}
        </p>
      ) : null}
    </section>
  );
}

/** Drops the destinations we hold no URL for — only known routes render. */
function liveSlots(candidates: LinkCandidate[]): LinkSlot[] {
  return candidates.filter((slot): slot is LinkSlot => slot.url !== null);
}

export function BrandSocialLinks({
  brand,
  sectionIds,
  sectionClassName,
}: BrandLinksProps) {
  const t = useTranslations("brandDetail");

  const socialSlots = liveSlots([
    {
      label: t("links.instagram"),
      url: normalizeInstagramHref(brand.socialInstagram),
      linkType: "instagram",
      icon: <InstagramIcon className="size-4 text-current" />,
    },
    {
      label: t("links.threads"),
      url: normalizeThreadsHref(brand.socialThreads),
      linkType: "threads",
      icon: <AtSign className="size-4 text-current" />,
    },
    {
      label: t("links.facebook"),
      url: normalizeDirectUrl(brand.socialFacebook),
      linkType: "facebook",
      icon: <FacebookIcon className="size-4 text-current" />,
    },
  ]);

  // The section nav always lists #social, so the section renders even empty.
  return (
    <LinkSection
      id={sectionIds?.social}
      label={t("links.socialPlatforms")}
      slots={socialSlots}
      brand={brand}
      className={sectionClassName}
      note={socialSlots.length === 0 ? t("links.noSocialLinks") : null}
    />
  );
}

export function BrandPurchaseLinks({
  brand,
  sectionIds,
  sectionClassName,
}: BrandLinksProps) {
  const t = useTranslations("brandDetail");

  const purchaseSlots = liveSlots(
    ONLINE_STORES.map((channel) => ({
      label: t(
        onlineStoreMessageKey(
          channel.messageKeys.brandDetailLink,
          "brandDetail",
        ),
      ),
      url: normalizeDirectUrl(brand[channel.camel]),
      linkType: channel.key,
      ...PURCHASE_PRESENTATION[channel.key],
    })),
  );
  // One muted line stands in for every store we hold no link for, instead of a
  // dimmed chip per store.
  const hasMissingChannel = purchaseSlots.length < ONLINE_STORES.length;
  const note =
    purchaseSlots.length === 0
      ? t("links.noChannels")
      : hasMissingChannel
        ? t("links.missingChannels")
        : null;

  return (
    <LinkSection
      id={sectionIds?.purchase}
      label={t("links.onlineStores")}
      headingLevel="h3"
      slots={purchaseSlots}
      brand={brand}
      className={sectionClassName}
      note={note}
    />
  );
}

export function BrandOtherLinks({ brand, sectionClassName }: BrandLinksProps) {
  const t = useTranslations("brandDetail");

  const otherSlots: LinkSlot[] = brand.otherUrls.flatMap((otherUrl) => {
    const label = otherUrl.label?.trim() ?? "";
    const url = normalizeDirectUrl(otherUrl.url);
    if (!label || !url) return [];

    return [
      {
        label,
        url,
        linkType: "other",
        icon: <Link className="size-4 text-current" />,
      },
    ];
  });

  return (
    <LinkSection
      label={t("links.otherLinks")}
      slots={otherSlots}
      brand={brand}
      className={sectionClassName}
    />
  );
}

type ChannelCorrectionDialog = "purchase" | "stockist" | "social";

/**
 * The where-to-buy block's one correction line. It replaces three accent
 * provide-info triggers that competed with the route out; all three submission
 * flows stay reachable from one menu. Same shape as the hero overflow menu in
 * `brand-actions.tsx`: the dialogs live outside the menu so they survive it
 * closing, and a menu item only flips which dialog is open.
 */
export function BrandChannelCorrections({
  brand,
}: {
  brand: PublicBrandDetail;
}) {
  const t = useTranslations("brandDetail");
  const [openDialog, setOpenDialog] = useState<ChannelCorrectionDialog | null>(
    null,
  );
  const purchaseLinks = Object.fromEntries(
    ONLINE_STORES.map((channel) => [channel.column, brand[channel.camel]]),
  ) as Record<OnlineStoreColumn, string | null>;

  function dialogProps(dialog: ChannelCorrectionDialog) {
    return {
      open: openDialog === dialog,
      onOpenChange: (open: boolean) => setOpenDialog(open ? dialog : null),
    };
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-1 type-metadata">
        <span>{t("links.correctionPrompt")}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="compact" className="px-1" />}
          >
            {t("links.correctionAction")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto">
            <DropdownMenuItem
              size="touch"
              onClick={() => setOpenDialog("purchase")}
            >
              {t("links.correctionPurchase")}
            </DropdownMenuItem>
            <DropdownMenuItem
              size="touch"
              onClick={() => setOpenDialog("stockist")}
            >
              {t("links.correctionStockist")}
            </DropdownMenuItem>
            <DropdownMenuItem
              size="touch"
              onClick={() => setOpenDialog("social")}
            >
              {t("links.correctionSocial")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CorrectionDialog
        mode="purchaseLinks"
        brandId={brand.id}
        brandSlug={brand.slug}
        purchaseLinks={purchaseLinks}
        {...dialogProps("purchase")}
      />
      <ProvideStockistInfoDialog
        brandId={brand.id}
        brandSlug={brand.slug}
        {...dialogProps("stockist")}
      />
      <CorrectionDialog
        mode="socialLinks"
        brandId={brand.id}
        brandSlug={brand.slug}
        socialInstagram={brand.socialInstagram}
        socialThreads={brand.socialThreads}
        socialFacebook={brand.socialFacebook}
        {...dialogProps("social")}
      />
    </>
  );
}

export function BrandLinks({
  brand,
  sectionIds,
  sectionClassName,
}: BrandLinksProps) {
  return (
    <>
      <BrandSocialLinks
        brand={brand}
        sectionIds={sectionIds}
        sectionClassName={sectionClassName}
      />
      <BrandPurchaseLinks
        brand={brand}
        sectionIds={sectionIds}
        sectionClassName={sectionClassName}
      />
      <BrandOtherLinks brand={brand} sectionClassName={sectionClassName} />
    </>
  );
}
