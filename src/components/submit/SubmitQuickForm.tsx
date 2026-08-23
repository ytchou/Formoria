"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
  submitOwnerQuick,
  suggestCleanName,
} from "@/app/[locale]/(site)/submit/actions";
import { FormField } from "@/components/forms/form-field";
import {
  StandardForm,
  StandardFormStack,
} from "@/components/forms/form-layout";
import { MarketingEmailOptInField } from "@/components/forms/marketing-email-opt-in-field";
import { TurnstileWidget } from "@/components/submit/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/ui/page-shell";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { trackSubmissionCompleted } from "@/lib/analytics";
import { stripUrlQuery } from "@/lib/url";
import { useSubmissionAnalytics } from "@/hooks/use-submission-analytics";
import { routes } from "@/lib/routes";
import { HoneypotField } from '@/components/forms/honeypot-field'

type Translator = (key: string) => string;

function createQuickSubmissionSchema(t: Translator) {
  return z.object({
    name: z.string().min(1, t("validation.nameMinLength")),
    romanizedName: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-zA-Z0-9\s\-'.]+$/)
      .optional()
      .or(z.literal("")),
    website: z.string().url(t("validation.urlInvalid")),
    description: z.string().min(1, t("validation.descriptionRequired")),
    pdpaConsent: z.literal(true, {
      error: t("validation.pdpaRequired"),
    }),
    marketingEmailOptIn: z.boolean(),
    turnstileToken: z.string().min(1, t("validation.turnstileRequired")),
    honeypot: z.string(),
  });
}

type QuickSubmissionFormData = z.infer<
  ReturnType<typeof createQuickSubmissionSchema>
>;

export default function SubmitQuickForm() {
  const t = useTranslations("submit");
  const tReview = useTranslations("submit.review");
  const router = useRouter();
  const { complete } = useSubmissionAnalytics("quick", "owner", "opened");
  const nameBlurRequestRef = useRef(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null);
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState(false);

  const tSchema = useMemo(
    () => (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  );
  const schema = useMemo(() => createQuickSubmissionSchema(tSchema), [tSchema]);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isValid },
  } = useForm<QuickSubmissionFormData>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      romanizedName: "",
      website: "",
      description: "",
      pdpaConsent: false as QuickSubmissionFormData["pdpaConsent"],
      marketingEmailOptIn: false,
      turnstileToken: "",
      honeypot: "",
    },
  });

  const pdpaConsent = useWatch({ control, name: "pdpaConsent" });
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

  const handleNameBlur = async () => {
    const currentName = getValues("name");
    if (!currentName || currentName.length < 2) return;

    const requestId = ++nameBlurRequestRef.current;
    try {
      const result = await suggestCleanName(currentName);
      if (requestId !== nameBlurRequestRef.current) return;

      if (result.changed && result.suggestion) {
        setNameSuggestion(result.suggestion);
      } else {
        setNameSuggestion(null);
      }
    } catch {
      if (requestId === nameBlurRequestRef.current) {
        setNameSuggestion(null);
      }
    }
  };

  function handleWebsiteBlur(value: string) {
    if (!value || !value.includes("?")) {
      setUrlSuggestion(null);
      return;
    }

    const cleaned = stripUrlQuery(value);
    setUrlSuggestion(cleaned !== value && cleaned.length > 0 ? cleaned : null);
  }

  const handleTurnstileSuccess = useCallback(
    (token: string) => {
      setTurnstileError(false);
      setValue("turnstileToken", token, { shouldValidate: true });
    },
    [setValue],
  );

  const handleTurnstileError = useCallback(() => {
    setTurnstileError(true);
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const handleTurnstileExpire = useCallback(() => {
    setValue("turnstileToken", "", { shouldValidate: true });
  }, [setValue]);

  const submitForm = useCallback(
    async (data: QuickSubmissionFormData) => {
      // Ref, not state: `isSubmitting` does not update until the next render, so
      // two activations in the same tick both read `false` and both submit.
      // The lock is released only on paths that leave the visitor on this form —
      // a successful submission is terminal, and the redirect that follows is a
      // router.push that takes real time (DEV-1415).
      if (submitLockRef.current) return;
      submitLockRef.current = true;

      setSubmitError(null);
      setIsSubmitting(true);

      const unlock = () => {
        submitLockRef.current = false;
        setIsSubmitting(false);
      };

      try {
        const result = await submitOwnerQuick(data, idempotencyKeyRef.current);
        if (result?.error) {
          setSubmitError(result.error);
          unlock();
          return;
        }

        setPendingRedirect(routes.submit.confirmation({ intent: "owner_claim" }));

        trackSubmissionCompleted(
          data.name,
          "",
          false,
          complete(),
          "owner_claim",
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
      void handleSubmit(submitForm)(event);
    },
    [handleSubmit, submitForm],
  );

  const isSubmitDisabled = !isValid || !pdpaConsent || isSubmitting;

  return (
    <PageShell measure="form" className="py-12">
      <div className="mb-8">
        <h1 className="text-balance text-center type-section">
          {t("quickForm.heading")}
        </h1>
        <p className="mt-3 text-center type-body-sm">
          {t("quickForm.subheading")}
        </p>
      </div>

      <StandardForm onSubmit={onSubmit} noValidate>
        <StandardFormStack>
          <FormField
            id="submit-name"
            label={t("fields.brandName")}
            error={errors.name?.message}
            required
          >
            <Input
              id="submit-name"
              type="text"
              autoComplete="off"
              placeholder={t("fields.brandNamePlaceholder")}
              {...nameRegistration}
              onBlur={async (event) => {
                nameRegistration.onBlur(event);
                await handleNameBlur();
              }}
              onChange={(event) => {
                setNameSuggestion(null);
                nameRegistration.onChange(event);
              }}
            />
            {nameSuggestion ? (
              <div className="animate-reveal-up">
                <div className="flex items-center justify-between gap-3 rounded-[3px] border border-rule bg-surface p-3 type-body-sm text-ink-soft">
                  <span>
                    {t("ownerForm.suggestedName")}{" "}
                    <strong>{nameSuggestion}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setValue("name", nameSuggestion, {
                        shouldValidate: true,
                      });
                      setNameSuggestion(null);
                    }}
                  >
                    {t("ownerForm.applySuggestion")}
                  </Button>
                </div>
              </div>
            ) : null}
          </FormField>

          <FormField
            id="submit-romanized-name"
            label={t("ownerForm.romanizedNameLabel")}
            description={t("ownerForm.romanizedNameHint")}
            error={errors.romanizedName?.message}
          >
            <Input
              id="submit-romanized-name"
              type="text"
              autoComplete="off"
              placeholder={t("ownerForm.romanizedNamePlaceholder")}
              {...register("romanizedName")}
            />
          </FormField>

          <FormField
            id="submit-website"
            label={t("ownerForm.websiteLabel")}
            error={errors.website?.message}
            required
          >
            <Input
              id="submit-website"
              type="url"
              autoComplete="off"
              placeholder={t("ownerForm.websitePlaceholder")}
              {...websiteRegistration}
              onBlur={(event) => {
                websiteRegistration.onBlur(event);
                handleWebsiteBlur(event.target.value);
              }}
              onChange={(event) => {
                websiteRegistration.onChange(event);
                setUrlSuggestion(null);
              }}
            />
            {urlSuggestion ? (
              <div className="animate-reveal-up">
                <div className="flex items-center justify-between gap-3 rounded-[3px] border border-rule bg-surface p-3 type-body-sm text-ink-soft">
                  <span>
                    {t("ownerForm.suggestedUrl")}{" "}
                    <strong>{urlSuggestion}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setValue("website", urlSuggestion, {
                        shouldValidate: true,
                      });
                      setUrlSuggestion(null);
                    }}
                  >
                    {t("ownerForm.applySuggestion")}
                  </Button>
                </div>
              </div>
            ) : null}
          </FormField>

          <FormField
            id="submit-description"
            label={t("ownerForm.descriptionLabel")}
            error={errors.description?.message}
            required
          >
            <Textarea
              id="submit-description"
              rows={4}
              placeholder={t("ownerForm.descriptionPlaceholder")}
              {...register("description")}
            />
          </FormField>

          <div className="space-y-2">
            <Controller
              name="pdpaConsent"
              control={control}
              render={({ field, fieldState }) => (
                <div className="space-y-1">
                  <Label className="flex min-h-12 cursor-pointer items-start gap-3">
                    <Checkbox
                      id="submit-pdpa"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked)}
                      className="mt-0.5 size-[18px] shrink-0"
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
                    </span>
                  </Label>
                  {fieldState.error ? (
                    <p className="type-metadata text-danger">{fieldState.error.message}</p>
                  ) : null}
                </div>
              )}
            />
          </div>

          <Controller
            name="marketingEmailOptIn"
            control={control}
            render={({ field }) => (
              <MarketingEmailOptInField
                id="submit-marketing-email"
                variant="newsletter-only"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />

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
            idleLabel={t("quickForm.submitButton")}
            submittingLabel={t("quickForm.submittingButton")}
          />
        </StandardFormStack>
      </StandardForm>
    </PageShell>
  );
}
