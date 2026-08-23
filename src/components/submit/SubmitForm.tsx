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
  const router = useRouter();
  const { complete } = useSubmissionAnalytics(source, "recommend", "opened");
  const nameBlurRequestRef = useRef(0);
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState(false);

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
    formState: { errors, isValid },
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

  const pdpaConsent = useWatch({ control, name: "pdpaConsent" });
  // Opting into the newsletter makes the otherwise-optional email mandatory
  // (enforced in the schema) — mirror that in the label's required marker.
  const marketingEmailOptIn = useWatch({
    control,
    name: "marketingEmailOptIn",
  });
  const duplicateConfirmed = useWatch({ control, name: "duplicateConfirmed" });
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null);
  const [nameMatches, setNameMatches] = useState<DuplicateCandidate[]>([]);
  const [websiteMatches, setWebsiteMatches] = useState<DuplicateCandidate[]>(
    [],
  );
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  async function handleWebsiteBlur(value: string) {
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

  const websiteRegistration = register("website");
  const nameRegistration = register("name");

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
        const result:
          { error?: string; ownershipAdjusted?: boolean } | undefined =
          await submitRecommendation(data, idempotencyKeyRef.current);

        if (result?.error) {
          setSubmitError(result.error);
          unlock();
          return;
        }

        const query = new URLSearchParams({
          intent: "recommend",
        });
        if (result?.ownershipAdjusted) {
          query.set("ownership", "community");
        }
        setPendingRedirect(`${routes.submit.confirmation()}?${query.toString()}`);

        trackSubmissionCompleted(
          data.name,
          "",
          Boolean(data.heroImageUrl),
          complete(),
          "recommend",
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
      void handleSubmit(submitForm, (validationErrors) => {
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
    [handleSubmit, submitForm],
  );

  const isSubmitDisabled =
    !isValid ||
    !pdpaConsent ||
    ((nameMatches.length > 0 || websiteMatches.length > 0) &&
      !duplicateConfirmed) ||
    isSubmitting;

  return (
    <PageShell measure="form" className="py-20">
      <div className="mb-10">
        <h1 className="text-balance text-center type-page-title">
          {tForm("heading")}
        </h1>
        <span
          className="mx-auto mt-4 block h-0.5 w-8 bg-accent"
          aria-hidden="true"
        />
        <p className="mt-4 text-center type-body-sm">
          {tForm("subheading")}
        </p>
      </div>

      <StandardForm onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-5">
          <p className="type-metadata">
            <span className="text-danger">*</span> {tForm("requiredHint")}
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
                type="url"
                autoComplete="off"
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
              render={({ field }) => (
                <NativeSelect
                  id="submit-source"
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
                  variant="newsletter-only"
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
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked)}
                      className="mt-0.5 size-[18px] shrink-0"
                      aria-required="true"
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
                  {fieldState.error ? (
                    <p className="type-metadata text-danger">{fieldState.error.message}</p>
                  ) : null}
                </div>
              )}
            />
          </div>

          <HoneypotField {...register("honeypot")} />

          <div className="flex justify-center">
            <TurnstileWidget
              onSuccess={handleTurnstileSuccess}
              onError={handleTurnstileError}
              onExpire={handleTurnstileExpire}
            />
          </div>
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

          <SubmitButton
            variant="primary"
            disabled={isSubmitDisabled}
            isSubmitting={isSubmitting}
            idleLabel={tForm("submitButton")}
            submittingLabel={tForm("submittingButton")}
          />
        </div>
      </StandardForm>
    </PageShell>
  );
}
