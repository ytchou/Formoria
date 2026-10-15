"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Link } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Typography } from "@/components/ui/typography";
import type {
  BrandChannelCorrectionFields,
  BrandChannelSlot,
  BrandOtherLink,
} from "@/lib/services/brand-detail-view";
import {
  ONLINE_STORES,
  type OnlineStoreColumn,
} from "@/lib/brands/online-stores";
import { trackExternalLinkClicked } from "@/lib/analytics";
import type { BrandVisitLinkKind } from "@/lib/brands/link-fallback";
import { cn } from "@/lib/utils";
import { CorrectionDialog } from "./correction-dialog";
import { ProvideStockistInfoDialog } from "./provide-stockist-info-dialog";

/** What the click tracking needs to know about the brand. */
type TrackedBrand = { id: string; slug: string };

type LinkSlot = {
  label: string;
  url: string;
  linkType: BrandVisitLinkKind | "other";
  icon: ReactNode;
};

type LinkListProps = {
  /** Only known destinations: a slot without a URL never reaches here. */
  slots: LinkSlot[];
  brand: TrackedBrand;
  className?: string;
  /** One muted line below the links; a list with a note always renders. */
  note?: string | null;
};

const destinationLinkClassName = buttonVariants({
  variant: "secondary",
  shape: "pill",
  size: "compact",
  className: "min-w-32 max-w-full justify-center gap-2",
});

/**
 * An external brand link that records the channel it routes to: the one
 * tracked anchor every brand-channel surface on the page renders.
 */
function TrackedChannelLink({
  href,
  kind,
  brand,
  className,
  children,
}: {
  href: string;
  kind: BrandVisitLinkKind | "other";
  brand: TrackedBrand;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      data-ph-no-autocapture
      onClick={() => {
        trackExternalLinkClicked(
          brand.slug,
          kind,
          typeof window !== "undefined" ? window.location.pathname : "",
          "detail_page",
          brand.id,
        );
      }}
    >
      {children}
    </a>
  );
}

const CHANNEL_ROW_CLASS_NAME =
  "flex min-h-11 items-center justify-between gap-3 text-ink transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Brand channels as hairline-divided rows (BD-06): the channel name, its
 * destination host, and an out arrow. The hero route rows and where-to-buy's
 * online and social lists are all this list, fed from the same slots
 * (`buildBrandChannelSlots`).
 */
export function BrandChannelRows({
  brand,
  slots,
  ariaLabel,
  className,
}: {
  brand: TrackedBrand;
  slots: BrandChannelSlot[];
  ariaLabel?: string;
  className?: string;
}) {
  const t = useTranslations("brandDetail");
  if (slots.length === 0) return null;

  return (
    <ul
      aria-label={ariaLabel}
      className={cn("divide-y divide-rule border-y border-rule", className)}
    >
      {slots.map((slot) => (
        <li key={`${slot.kind}:${slot.url}`}>
          <TrackedChannelLink
            href={slot.url}
            kind={slot.kind}
            brand={brand}
            className={CHANNEL_ROW_CLASS_NAME}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 type-label">{t(slot.labelKey)}</span>
              {slot.host ? (
                <span className="min-w-0 truncate type-metadata">
                  {slot.host}
                </span>
              ) : null}
            </span>
            <ArrowUpRight className="size-4 shrink-0" aria-hidden />
          </TrackedChannelLink>
        </li>
      ))}
    </ul>
  );
}

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

/**
 * The links and their muted note: a section body. The `<section>`, its id and
 * its h2 belong to `BrandSection`, which the page wraps around this.
 */
function LinkList({ slots, brand, className, note }: LinkListProps) {
  if (slots.length === 0 && !note) return null;

  return (
    <div className={className}>
      {slots.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {slots.map((slot, index) => (
            <TrackedChannelLink
              key={`${slot.linkType}:${slot.label}:${index}`}
              href={slot.url}
              kind={slot.linkType}
              brand={brand}
              className={destinationLinkClassName}
            >
              <DestinationLinkButton slot={slot}>
                {slot.label}
              </DestinationLinkButton>
            </TrackedChannelLink>
          ))}
        </div>
      ) : null}
      {note ? (
        <p
          className={slots.length > 0 ? "mt-3 type-metadata" : "type-metadata"}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The online-store block under where-to-buy's h2, with its own h3: the same
 * rows the hero carries, from `buildBrandChannelSlots().purchase`. A store we
 * hold no link for is left out without comment (BD-COPY-03); only a brand with
 * no online store at all gets a muted line.
 */
export function BrandPurchaseLinks({
  brand,
  slots,
}: {
  brand: TrackedBrand;
  slots: BrandChannelSlot[];
}) {
  const t = useTranslations("brandDetail");

  // A block, not a nested <section>: it sits inside the where-to-buy section.
  return (
    <div>
      <Typography as="h3" variant="cardTitle">
        {t("links.onlineStores")}
      </Typography>
      {slots.length > 0 ? (
        <BrandChannelRows brand={brand} slots={slots} className="mt-4" />
      ) : (
        <p className="mt-4 type-metadata">{t("links.noChannels")}</p>
      )}
    </div>
  );
}

/**
 * The official-social block under where-to-buy's h2, after the online stores
 * and before the stockist list, so a long list never buries it. Rows from
 * `buildBrandChannelSlots().social`. A brand with no social profile renders
 * nothing: a missing channel is left out without comment (BD-COPY-03).
 */
export function BrandSocialChannels({
  brand,
  slots,
}: {
  brand: TrackedBrand;
  slots: BrandChannelSlot[];
}) {
  const t = useTranslations("brandDetail");
  if (slots.length === 0) return null;

  // A block, not a nested <section>: it sits inside the where-to-buy section.
  return (
    <div>
      <Typography as="h3" variant="cardTitle">
        {t("links.officialSocial")}
      </Typography>
      <BrandChannelRows brand={brand} slots={slots} className="mt-4" />
    </div>
  );
}

/**
 * The other-links section's body. `links` are already filtered to a label and
 * a safe URL (`buildBrandDetailView`), so the page renders the section only
 * when there is one.
 */
export function BrandOtherLinks({
  brand,
  links,
}: {
  brand: TrackedBrand;
  links: BrandOtherLink[];
}) {
  const otherSlots: LinkSlot[] = links.map(({ label, url }) => ({
    label,
    url,
    linkType: "other",
    icon: <Link className="size-4 text-current" />,
  }));

  return <LinkList slots={otherSlots} brand={brand} className="mt-4" />;
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
  brand: BrandChannelCorrectionFields;
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
