"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";

import { subscribeToNewsletter } from "@/app/actions/newsletter";
import type { SubscribeNewsletterState } from "@/app/actions/newsletter";
import { FormField } from "@/components/forms/form-field";
import { HoneypotField } from "@/components/forms/honeypot-field";
import { Label } from "@/components/ui/label";
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

const ERROR_MESSAGES = {
  invalidEmail: "errors.invalidEmail",
  rateLimited: "errors.rateLimited",
  confirmationFailed: "errors.confirmationFailed",
  generic: "errors.generic",
} as const;

// Client-side mirror of the server's invalidEmail check, so a malformed address
// gets the localized inline error instead of the browser's English bubble. The
// server action still validates; this only saves the round trip.
const emailSchema = z.email();

export function EmailCaptureForm() {
  const locale = useLocale();
  const t = useTranslations("newsletter");
  const emailId = useId();
  const emailErrorId = useId();
  const [nativeState, formAction, nativePending] = useActionState(
    subscribeToNewsletter,
    {},
  );
  const [clientState, setClientState] = useState<SubscribeNewsletterState>();
  const [clientPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [invalidEmail, setInvalidEmail] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const state = clientState ?? nativeState;
  const errorKey = invalidEmail ? "invalidEmail" : state.error;
  const errorMessage = errorKey ? t(ERROR_MESSAGES[errorKey]) : undefined;
  const isPending = nativePending || clientPending;
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    if (!emailSchema.safeParse(email.trim()).success) {
      setInvalidEmail(true);
      emailInputRef.current?.focus();
      return;
    }
    setInvalidEmail(false);
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        setClientState(await subscribeToNewsletter(state, data));
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        setClientState({ error: "generic" });
      }
    });
  }

  if (state.success) {
    return (
      <div className="rounded-surface bg-verified-green-bg px-4 py-3 type-body-sm font-medium text-ink text-verified-green">
        {t("success")}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={handleSubmit}
      className="space-y-4 text-ink"
    >
      {/* Anti-spam honeypot: invisible to humans, filled in by naive bots, and
          rejected server-side by isHoneypotFilled(). It cannot be an <Input> —
          the primitive's visible styling and focus behaviour are exactly what a
          field only a bot should ever reach must not have. */}
      <HoneypotField />
      <input type="hidden" name="locale" value={locale} />

      <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
        <legend className="mb-2 p-0 type-body-sm font-medium text-ink-soft">
          {t("interestsLabel")}
        </legend>
        {/* Wraps below `sm` so every chip stays visible on a phone (DS-42),
            and scrolls as one row from `sm` up — but always a `ChipRow`, so
            the 14px that keeps the 36px chip's touch target honest is the same
            here as everywhere else. */}
        <ChipRow className="sm:flex-nowrap sm:overflow-x-auto">
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
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label className="sr-only" htmlFor={emailId}>
            {t("emailLabel")}
          </Label>
          {/* Outside FormField so its space-y-2 never pushes the input below
              the button's baseline; the error slot keeps the 8px gap. */}
          <FormField
            error={errorMessage}
            errorId={errorMessage ? emailErrorId : undefined}
          >
            <Input
              ref={emailInputRef}
              className="h-12 rounded-control border-rule bg-ground/50 text-ink placeholder:text-ink-muted focus-visible:border-ink focus-visible:ring-accent sm:h-11"
              id={emailId}
              name="email"
              placeholder={t("emailPlaceholder")}
              required
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (invalidEmail) setInvalidEmail(false);
              }}
            />
          </FormField>
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
