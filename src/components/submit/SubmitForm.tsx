"use client";

import {
  Fragment,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  createRecommendationSubmissionSchema,
  normalizeWebsiteUrl,
  type SubmissionFormData,
} from "@/lib/validations/submission";
import {
  inspectRecommendation,
  submitRecommendation,
} from "@/app/[locale]/(site)/submit/actions";
import { SOURCE_ATTRIBUTION_VALUES } from "@/lib/types/submission";
import type {
  DuplicateCandidate,
  SourceAttribution,
} from "@/lib/types/submission";
import { FormField } from "@/components/forms/form-field";
import { StandardForm } from "@/components/forms/form-layout";
import { MarketingEmailOptInField } from "@/components/forms/marketing-email-opt-in-field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PageShell } from "@/components/ui/page-shell";
import { Textarea } from "@/components/ui/textarea";
import { TurnstileWidget } from "@/components/submit/TurnstileWidget";
import { cn } from "@/lib/utils";
import {
  trackSubmissionCompleted,
  trackSubmissionFormErrorShown,
} from "@/lib/analytics";
import { useSubmissionAnalytics } from "@/hooks/use-submission-analytics";
import { routes } from "@/lib/routes";
import { HoneypotField } from '@/components/forms/honeypot-field'
import { Check } from "lucide-react";

// Inlined at build time; the widget renders nothing without it, so neither
// does its row (SP2-21).
const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * A duplicate hit reads as a plain red line, matching every other field error
 * in the form — the matched brands are inline links so the visitor can check
 * for themselves. `children` carries the confirm checkbox, which only the
 * first triggering field renders (see `confirmUnder`).
 */
function DuplicateNotice({
  title,
  candidates,
  reasonLabels,
  children,
}: {
  title: string;
  candidates: DuplicateCandidate[];
  reasonLabels?: { cjk: string; latin: string };
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="type-body-sm text-danger">
        {title}
        {candidates.map((candidate, index) => (
          <Fragment key={candidate.id}>
            {index === 0 ? " " : ", "}
            <Link
              href={routes.brand(candidate.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {candidate.name}
            </Link>
            {reasonLabels &&
            (candidate.matchedOn === "cjk" || candidate.matchedOn === "latin")
              ? `\uFF08${reasonLabels[candidate.matchedOn]}\uFF09`
              : null}
          </Fragment>
        ))}
      </p>
      {children}
    </div>
  );
}

type SubmitFormProps = {
  source?: "header_cta" | "hero_cta" | "footer_link";
  // Prefilled from the directory's no-results CTA so the visitor doesn't retype the name
  // they just searched for. Read server-side from `?name=` and passed down, deliberately
  // not via useSearchParams — that would need a Suspense boundary in this client tree.
  initialName?: string;
};

export default function SubmitForm({
  source = "hero_cta",
  initialName = "",
}: SubmitFormProps) {
  const t = useTranslations("submit");
  const tForm = useTranslations("submit.recommendForm");
  const tReview = useTranslations("submit.review");
  const tOverview = useTranslations("submit.overview");
  const router = useRouter();
  const { complete } = useSubmissionAnalytics(source, "opened");
  const nameBlurRequestRef = useRef(0);
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  );
  const schema = useMemo(
    () => createRecommendationSubmissionSchema(tSchema),
    [tSchema],
  );
  const resolver = useMemo(
    () => zodResolver(schema as never) as Resolver<SubmissionFormData>,
    [schema],
  );

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    trigger,
    setFocus,
    formState: { errors },
  } = useForm<SubmissionFormData>({
    resolver,
    defaultValues: {
      name: initialName,
      website: "",
      description: "",
      guestEmail: "",
      marketingEmailOptIn: false,
      duplicateConfirmed: false,
      sourceAttribution: undefined,
      pdpaConsent: false,
      turnstileToken: "",
      honeypot: "",
    },
    mode: "onTouched",
  });

  // Opting into the newsletter makes the otherwise-optional email mandatory
  // (enforced in the schema) — mirror that in the label's required marker.
  const marketingEmailOptIn = useWatch({
    control,
    name: "marketingEmailOptIn",
  });
  const duplicateConfirmed = useWatch({ control, name: "duplicateConfirmed" });
  const turnstileToken = useWatch({ control, name: "turnstileToken" });
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null);
  const [nameMatches, setNameMatches] = useState<DuplicateCandidate[]>([]);
  const [websiteMatches, setWebsiteMatches] = useState<DuplicateCandidate[]>(
    [],
  );
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Duplicate confirmation is client state, not schema: the matches come from
  // the inspection call, so the resolver cannot know about them.
  const hasUnconfirmedDuplicates =
    (nameMatches.length > 0 || websiteMatches.length > 0) &&
    !duplicateConfirmed;

  // A confirmation only speaks for the exact name/website pair it was shown
  // for, so any edit to either field drops both the matches and the tick.
  const clearDuplicateState = useCallback(() => {
    setNameMatches([]);
    setWebsiteMatches([]);
    setValue("duplicateConfirmed", false);
  }, [setValue]);

  // The one door for programmatic writes to the two deduped fields. setValue
  // does not fire the input's onChange, so an apply-suggestion click would
  // otherwise rewrite the name while leaving the matches — and the user's tick
  // — standing for a name they never confirmed.
  const applySuggestion = useCallback(
    (field: "name" | "website", value: string) => {
      setValue(field, value);
      nameBlurRequestRef.current += 1;
      clearDuplicateState();
    },
    [setValue, clearDuplicateState],
  );

  // Both fields can match at once, but one tick answers for the whole
  // submission — so the checkbox is rendered under the first field that hit,
  // never twice against the same form value.
  const confirmUnder = nameMatches.length > 0 ? "name" : "website";
  const duplicateConfirmField = (
    <Controller
      name="duplicateConfirmed"
      control={control}
      render={({ field }) => (
        <Label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            id="submit-duplicate-confirmed"
            ref={field.ref}
            checked={field.value ?? false}
            onCheckedChange={(checked) => field.onChange(checked)}
            className="mt-0.5 size-[18px] shrink-0"
          />
          <span className="type-body-sm text-ink-soft font-normal">
            {t("fields.nameDuplicateConfirmLabel")}
          </span>
        </Label>
      )}
    />
  );

  const handleNameBlur = async () => {
    const currentName = getValues("name");
    if (!currentName || currentName.length < 2) return;

    const requestId = ++nameBlurRequestRef.current;
    try {
      const result = await inspectRecommendation(
        currentName,
        getValues("website") || undefined,
      );
      if (requestId !== nameBlurRequestRef.current) return;
      setNameMatches(result.nameMatches);
      setWebsiteMatches(result.websiteMatches);
      if (result.changed && result.suggestion) {
        setNameSuggestion(result.suggestion);
      } else {
        setNameSuggestion(null);
      }
    } catch {
      if (requestId === nameBlurRequestRef.current) {
        setNameSuggestion(null);
        setNameMatches([]);
        setWebsiteMatches([]);
      }
    }
  };

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setTurnstileError(false);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue],
  );

  const handleTurnstileError = useCallback(() => {
    setTurnstileError(true);
  }, []);

  const handleTurnstileExpire = useCallback(() => {
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  async function handleWebsiteBlur(rawValue: string) {
    // Show the visitor the URL the schema will submit (`brand.com` becomes
    // `https://brand.com`). setValue skips the input's onChange, so clear the
    // duplicate state here; the inspection below bumps the request counter.
    const value = normalizeWebsiteUrl(rawValue);
    if (value !== rawValue) {
      setValue("website", value, { shouldValidate: true });
      clearDuplicateState();
    }

    if (!value || !value.includes("?")) {
      setUrlSuggestion(null);
    } else {
      const cleaned = value.split("?")[0];
      setUrlSuggestion(
        cleaned !== value && cleaned.length > 0 ? cleaned : null,
      );
    }

    if (!value) return;

    // Shares the name field's request counter so a blur on one field can never
    // be overwritten by a slower in-flight response from the other.
    const requestId = ++nameBlurRequestRef.current;
    try {
      const result = await inspectRecommendation(getValues("name"), value);
      if (requestId !== nameBlurRequestRef.current) return;
      setNameMatches(result.nameMatches);
      setWebsiteMatches(result.websiteMatches);
    } catch {
      if (requestId === nameBlurRequestRef.current) {
        setNameMatches([]);
        setWebsiteMatches([]);
      }
    }
  }

  // Registration order is the order react-hook-form walks to focus the first
  // invalid field on submit, so it follows the visual order.
  const nameRegistration = register("name");
  const websiteRegistration = register("website");

  useEffect(() => {
    if (!pendingRedirect) return;

    const timeout = setTimeout(() => {
      router.push(pendingRedirect);
      setPendingRedirect(null);
    }, 0);

    return () => clearTimeout(timeout);
  }, [pendingRedirect, router]);

  const submitForm = useCallback(
    async (data: SubmissionFormData) => {
      if (submitLockRef.current) return;
      submitLockRef.current = true;

      setSubmitError(null);
      setIsSubmitting(true);

      // Released only on the paths that leave the visitor on this form. A
      // successful submission is terminal for this form instance: the redirect
      // below is a router.push that takes real time to resolve, and the lock
      // used to be released in a `finally` before it — so a second activation
      // arriving during that window submitted again and created a duplicate row
      // (DEV-1415). The old test slept 1s and counted once, which is exactly
      // inside the window, so it never saw it.
      const unlock = () => {
        submitLockRef.current = false;
        setIsSubmitting(false);
      };

      try {
        const result: { error?: string } | undefined =
          await submitRecommendation(data, idempotencyKeyRef.current);

        if (result?.error) {
          setSubmitError(result.error);
          unlock();
          return;
        }

        // `sent` is what lets the confirmation page say the recommendation
        // arrived; opened without it, the page stays neutral (SP2-31).
        setPendingRedirect(routes.submit.confirmation({ sent: 1 }));

        trackSubmissionCompleted(
          data.name,
          "",
          Boolean(data.heroImageUrl),
          complete(),
          !data.guestEmail,
        );
      } catch (error) {
        unlock();
        throw error;
      }
    },
    [complete],
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      setSubmitAttempted(true);
      void handleSubmit(async (data) => {
        if (hasUnconfirmedDuplicates) {
          setFocus("duplicateConfirmed");
          return;
        }
        await submitForm(data);
      }, (validationErrors) => {
        for (const [fieldName, error] of Object.entries(validationErrors)) {
          if (error?.message) {
            trackSubmissionFormErrorShown(
              fieldName,
              "validation",
              "recommendation",
            );
          }
        }
      })(event);
    },
    [handleSubmit, submitForm, hasUnconfirmedDuplicates, setFocus],
  );

  // The non-field reasons a submit is refused. Field errors stay inline under
  // their fields; these have no field of their own to sit under. PDPA consent
  // is a field, so its message sits under the checkbox instead (SP2-20).
  const submitBlockers = [
    !turnstileToken ? t("validation.turnstileRequired") : null,
    hasUnconfirmedDuplicates ? t("fields.duplicateConfirmRequired") : null,
  ].filter((message): message is string => message !== null);

  return (
    // A `page` shell, with the form capped by a bare `form-measure` below:
    // a `form` shell centres the column (x≈248 at 1440) while /brands/join
    // and /contact start at the 64px gutter (SP2-22).
    <PageShell as="main" measure="page" className="py-section">
      {/* Left-aligned to the form edge, like every sibling page (SP2-22). The
          points and the owner line came from the removed /submit hub; they
          answer "do I need an account" and "is this for owners" (SP2-05). */}
      <div className="mb-10 prose-measure">
        <h1 className="text-balance break-keep type-page-title">
          {tForm("heading")}
        </h1>
        <p className="mt-4 type-body text-pretty">{tForm("subheading")}</p>
        <ul className="mt-4 space-y-2">
          {(["recommendPoint1", "recommendPoint2", "recommendPoint3"] as const).map(
            (key) => (
              <li key={key} className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-ink-muted"
                />
                <span className="type-body-sm">{tOverview(key)}</span>
              </li>
            ),
          )}
        </ul>
        <p className="mt-4 type-body-sm text-pretty">{tOverview("ownerNote")}</p>
      </div>

      {/* Below `sm` the page is the panel: a bordered, padded box inside the
          24px gutter left the inputs ~290px wide on a 390px screen (SP2-21). */}
      <StandardForm
        onSubmit={onSubmit}
        noValidate
        className="form-measure max-sm:border-0 max-sm:bg-transparent max-sm:p-0"
      >
        <div className="flex flex-col gap-5">
          <p className="type-metadata">
            {tForm.rich("requiredHint", {
              mark: (chunks) => <span className="text-danger">{chunks}</span>,
            })}
          </p>

          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              id="submit-name"
              label={tForm("brandNameLabel")}
              description={tForm("brandNameHint")}
              error={errors.name?.message}
              required
            >
              <Input
                id="submit-name"
                type="text"
                autoComplete="off"
                placeholder={tForm("brandNamePlaceholder")}
                {...nameRegistration}
                onBlur={async (event) => {
                  nameRegistration.onBlur(event);
                  await handleNameBlur();
                }}
                onChange={(event) => {
                  nameBlurRequestRef.current += 1;
                  setNameSuggestion(null);
                  clearDuplicateState();
                  setSubmitError(null);
                  nameRegistration.onChange(event);
                }}
              />
              {nameSuggestion ? (
                <div className="animate-reveal-up">
                  <div className="flex items-center justify-between gap-3 rounded-surface border border-rule bg-surface p-3 type-body-sm text-ink-soft">
                    <span>
                      {tForm("suggestedName")} <strong>{nameSuggestion}</strong>
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        applySuggestion("name", nameSuggestion);
                        setNameSuggestion(null);
                      }}
                    >
                      {tForm("applySuggestion")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {nameMatches.length > 0 ? (
                <DuplicateNotice
                  title={t("fields.nameDuplicateTitle")}
                  candidates={nameMatches}
                  reasonLabels={{
                    cjk: t("fields.duplicateReasonCjk"),
                    latin: t("fields.duplicateReasonLatin"),
                  }}
                >
                  {confirmUnder === "name" ? duplicateConfirmField : null}
                </DuplicateNotice>
              ) : null}
            </FormField>

            <FormField
              id="submit-website"
              label={tForm("websiteLabel")}
              description={tForm("websiteHint")}
              error={errors.website?.message}
              required
            >
              <Input
                id="submit-website"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder={tForm("websitePlaceholder")}
                {...websiteRegistration}
                onBlur={async (event) => {
                  websiteRegistration.onBlur(event);
                  await handleWebsiteBlur(event.target.value);
                }}
                onChange={(event) => {
                  nameBlurRequestRef.current += 1;
                  websiteRegistration.onChange(event);
                  setUrlSuggestion(null);
                  clearDuplicateState();
                }}
              />
              {urlSuggestion ? (
                <div className="overflow-hidden transition-all duration-200">
                  <div className="flex items-center justify-between gap-3 rounded-surface border border-rule bg-surface p-3 type-body-sm text-ink-soft">
                    <span>
                      {tForm("suggestedUrl")} <strong>{urlSuggestion}</strong>
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        applySuggestion("website", urlSuggestion);
                        setUrlSuggestion(null);
                      }}
                    >
                      {tForm("applySuggestion")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {websiteMatches.length > 0 ? (
                <DuplicateNotice
                  title={t("fields.websiteDuplicateTitle")}
                  candidates={websiteMatches}
                >
                  {confirmUnder === "website" ? duplicateConfirmField : null}
                </DuplicateNotice>
              ) : null}
            </FormField>
          </div>

          <FormField
            id="submit-source"
            label={tForm("sourceLabel")}
            error={errors.sourceAttribution?.message}
            required
          >
            <Controller
              name="sourceAttribution"
              control={control}
              render={({ field, fieldState }) => (
                <NativeSelect
                  id="submit-source"
                  ref={field.ref}
                  aria-required="true"
                  aria-invalid={fieldState.invalid || undefined}
                  aria-describedby={
                    fieldState.error ? "submit-source-error" : undefined
                  }
                  className={cn(
                    field.value ? "text-ink" : "text-ink-muted",
                  )}
                  value={field.value ?? ""}
                  onChange={(event) =>
                    field.onChange(
                      (event.target.value as SourceAttribution) || undefined,
                    )
                  }
                >
                  <option value="" disabled>
                    {tForm("sourcePlaceholder")}
                  </option>
                  {SOURCE_ATTRIBUTION_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {t(`attribution.${value}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </FormField>

          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              id="submit-guest-email"
              label={tForm("guestEmailLabel")}
              description={tForm("guestEmailHint")}
              error={errors.guestEmail?.message}
              required={marketingEmailOptIn}
            >
              <Input
                id="submit-guest-email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                placeholder={tForm("guestEmailPlaceholder")}
                {...register("guestEmail")}
              />
            </FormField>

            <FormField
              id="submit-description"
              label={tForm("descriptionLabel")}
              description={tForm("descriptionHint")}
              error={errors.description?.message}
            >
              {/* Starts at the input height of the field beside it and grows
                  with what's typed (field-sizing-content), instead of opening
                  as a 4-row box that leaves the two-column row lopsided. */}
              <Textarea
                id="submit-description"
                className="min-h-12"
                placeholder={tForm("descriptionPlaceholder")}
                {...register("description")}
              />
            </FormField>
          </div>

          {/* The two consent checkboxes read as one group, so they sit tighter
              than the form's field gap. Plain rows, no panel — the consent
              panel's box and shield icon gave the form's only legally required
              field two competing marks at the start of the row. */}
          <div className="space-y-2">
            <Controller
              name="marketingEmailOptIn"
              control={control}
              render={({ field }) => (
                <MarketingEmailOptInField
                  id="submit-marketing-email"
                  checked={field.value ?? false}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    // The checkbox sits away from the email input, so surface
                    // the "email required for newsletter" error right away.
                    void trigger("guestEmail");
                  }}
                />
              )}
            />

            <Controller
              name="pdpaConsent"
              control={control}
              render={({ field, fieldState }) => (
                <div className="space-y-1">
                  {/* min-h-12 keeps the mobile tap target; on wider screens the
                      label is a single line and the slack reads as a blank row. */}
                  <Label className="flex min-h-12 cursor-pointer items-start gap-3 sm:min-h-0">
                    <Checkbox
                      id="submit-pdpa"
                      ref={field.ref}
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked)}
                      className="mt-0.5 size-[18px] shrink-0"
                      aria-required="true"
                      // The message sits right under this row, not in the
                      // submit blockers below the button (SP2-20).
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={
                        fieldState.error ? "submit-pdpa-error" : undefined
                      }
                    />
                    <span className="type-body-sm text-ink-soft font-normal">
                      {tReview.rich("pdpaConsent", {
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
                      <span aria-hidden="true" className="text-danger">
                        {" "}
                        *
                      </span>
                    </span>
                  </Label>
                  {fieldState.error?.message ? (
                    <p
                      id="submit-pdpa-error"
                      className="pl-[30px] type-metadata text-danger"
                    >
                      {fieldState.error.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
          </div>

          <HoneypotField {...register("honeypot")} />

          {/* Reserves the widget's real height (65px) with a status line
              behind it, so the slot never reads as an empty gap while the
              widget paints. Both children share one grid cell. */}
          {TURNSTILE_ENABLED ? (
            <div className="grid min-h-[65px] place-items-center">
              {!turnstileToken && !turnstileError ? (
                <p className="col-start-1 row-start-1 type-metadata">
                  {tForm("turnstileLoading")}
                </p>
              ) : null}
              <div className="col-start-1 row-start-1">
                <TurnstileWidget
                  onSuccess={handleTurnstileSuccess}
                  onError={handleTurnstileError}
                  onExpire={handleTurnstileExpire}
                />
              </div>
            </div>
          ) : null}
          {turnstileError ? (
            <p className="type-body-sm text-danger" role="alert">
              {t("errors.turnstileError")}
            </p>
          ) : null}

          {submitError ? (
            <p
              role="alert"
              className="type-body-sm text-danger"
              aria-live="polite"
            >
              {submitError}
            </p>
          ) : null}

          <div className="space-y-2">
            <SubmitButton
              variant="primary"
              disabled={isSubmitting}
              isSubmitting={isSubmitting}
              idleLabel={tForm("submitButton")}
              submittingLabel={tForm("submittingButton")}
            />
            <div id="submit-blockers" role="status" aria-live="polite">
              {submitAttempted
                ? submitBlockers.map((message) => (
                    <p key={message} className="type-metadata text-danger">
                      {message}
                    </p>
                  ))
                : null}
            </div>
          </div>
        </div>
      </StandardForm>
    </PageShell>
  );
}
