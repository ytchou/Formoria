"use client";

import { useActionState, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { subscribeToNewsletter } from "@/app/actions/newsletter";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import { Link } from "@/i18n/navigation";
import { trackNewsletterSubscribed } from "@/lib/analytics";
import { routes } from "@/lib/routes";

const INTEREST_CHIPS = [
  { slug: "curated-picks", labelKey: "interests.curated-picks" },
  { slug: "brand-stories", labelKey: "interests.brand-stories" },
  { slug: "new-brands", labelKey: "interests.new-brands" },
  { slug: "mit-trends", labelKey: "interests.mit-trends" },
] as const;

export function EmailCaptureForm() {
  const locale = useLocale();
  const t = useTranslations("newsletter");
  const [state, formAction, isPending] = useActionState(
    subscribeToNewsletter,
    {},
  );
  const [selectedChips, setSelectedChips] = useState<string[]>([
    "curated-picks",
  ]);

  useEffect(() => {
    if (state.success) {
      trackNewsletterSubscribed(selectedChips, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once when state.success flips, reporting the chips as they were at submit time. The component early-returns into the success view immediately after, so selectedChips cannot change afterwards; adding it would only re-fire on an edit that can never happen.
  }, [state.success]);

  function toggleChip(slug: string) {
    setSelectedChips((current) =>
      current.includes(slug)
        ? current.filter((selectedSlug) => selectedSlug !== slug)
        : [...current, slug],
    );
  }

  if (state.success) {
    return (
      <div className="rounded-surface bg-verified-green-bg px-4 py-3 type-body-sm font-medium text-ink text-verified-green">
        {t("success")}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 text-ink">
      {/* Anti-spam honeypot: invisible to humans, filled in by naive bots, and
          rejected server-side by isHoneypotFilled(). It cannot be an <Input> —
          the primitive's visible styling and focus behaviour are exactly what a
          field only a bot should ever reach must not have. */}
      <HoneypotField />
      <input type="hidden" name="locale" value={locale} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Input
            aria-invalid={state.error ? "true" : undefined}
            className="h-12 rounded-control border-rule bg-ground/50 text-ink placeholder:text-ink-muted focus-visible:border-ink focus-visible:ring-accent sm:h-11"
            name="email"
            placeholder={t("emailPlaceholder")}
            required
            type="email"
          />
          {state.error ? (
            <p className="mt-2 type-body-sm text-danger" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>

        <Button
          variant="primary"
          data-ph-no-autocapture
          disabled={isPending}
          type="submit"
        >
          {isPending ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current/40 border-t-current"
            />
          ) : null}
          {t("subscribe")}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="type-body-sm font-medium text-ink-soft">
          {t("interestsLabel")}
        </p>
        {/* A scrolling row, not a wrapping one — but still a `ChipRow`, so
            the 14px that keeps the 36px chip's touch target honest is the same
            here as everywhere else. */}
        <ChipRow className="flex-nowrap overflow-x-auto">
          {INTEREST_CHIPS.map((chip) => {
            const isSelected = selectedChips.includes(chip.slug);

            return (
              <ToggleChip
                key={chip.slug}
                pressed={isSelected}
                size="chip"
                onPressedChange={() => toggleChip(chip.slug)}
              >
                {t(chip.labelKey)}
              </ToggleChip>
            );
          })}
        </ChipRow>
      </div>

      {selectedChips.map((slug) => (
        <input key={slug} name="interests" type="hidden" value={slug} />
      ))}

      <p className="type-metadata">
        {t.rich("consentNotice", {
          privacyPolicy: (chunks) => (
            <Link
              href={routes.privacy()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}
