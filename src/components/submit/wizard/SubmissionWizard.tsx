"use client";

import {
  type FormEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { submitOwnerDetailedBrand } from "@/app/[locale]/(site)/submit/actions";
import { useWizardController } from "@/components/brand-wizard/use-wizard-controller";
import { WizardFooter } from "@/components/brand-wizard/wizard-footer";
import { WizardSidebar } from "@/components/brand-wizard/wizard-sidebar";
import { TurnstileWidget } from "@/components/submit/TurnstileWidget";
import { MarketingEmailOptInField } from "@/components/forms/marketing-email-opt-in-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";
import { trackSubmissionCompleted } from "@/lib/analytics";
import { useSubmissionAnalytics } from "@/hooks/use-submission-analytics";
import type { WizardStep } from "@/lib/schemas/brand-edit";
import {
  SUBMISSION_SECTION_FIELDS,
  SUBMISSION_WIZARD_STEPS,
  type SubmissionWizardStepKey,
  submissionWizardRequiredSchema,
  submissionWizardSchema,
} from "@/lib/schemas/submission-wizard";
import {
  SubmissionWizardContext,
  type SubmissionWizardValues,
} from "./submission-wizard-context";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { LinksSection } from "./sections/LinksSection";
import { MediaSection } from "./sections/MediaSection";
import { routes } from "@/lib/routes";
import { HoneypotField } from "@/components/forms/honeypot-field";

type SubmissionWizardProps = {
  subcategorySuggestions?: string[];
};

const submissionStepFormSchema = submissionWizardSchema.and(
  z.object({
    pdpaConsent: z.boolean(),
    marketingEmailOptIn: z.boolean(),
    turnstileToken: z.string(),
    honeypot: z.string(),
  }),
);

const submissionFormSchema = submissionWizardRequiredSchema.and(
  z.object({
    pdpaConsent: z.literal(true),
    marketingEmailOptIn: z.boolean().default(false),
    turnstileToken: z.string().min(1),
    honeypot: z.string(),
  }),
);

const SIDEBAR_STEPS: WizardStep[] = SUBMISSION_WIZARD_STEPS.map((step) => ({
  key: step.key,
}));

const FIELD_STEPS: Partial<Record<keyof SubmissionWizardValues, number>> = {
  name: 0,
  romanizedName: 0,
  website: 0,
  description: 0,
  categorySlug: 0,
  foundingYear: 0,
  subcategories: 0,
  city: 0,
  mitStory: 0,
  heroImageUrl: 1,
  productPhotos: 1,
  socialInstagram: 2,
  socialThreads: 2,
  socialFacebook: 2,
  purchaseWebsite: 2,
  purchasePinkoi: 2,
  purchaseShopee: 2,
  purchaseMyship: 2,
  otherUrls: 2,
  pdpaConsent: 2,
  marketingEmailOptIn: 2,
  turnstileToken: 2,
  honeypot: 2,
};

export default function SubmissionWizard({
  subcategorySuggestions = [],
}: SubmissionWizardProps) {
  const t = useTranslations("submit");
  const tReview = useTranslations("submit.review");
  const router = useRouter();
  const uploadSessionId = useId().replaceAll(":", "");
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const { complete, stepCompleted } = useSubmissionAnalytics(
    "hero_cta",
    "owner_claim",
    "opened",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState(false);

  const resolver = useMemo(() => zodResolver(submissionStepFormSchema), []);
  const form = useForm<SubmissionWizardValues>({
    resolver,
    defaultValues: {
      name: "",
      romanizedName: "",
      website: "",
      description: "",
      categorySlug: undefined,
      foundingYear: undefined,
      subcategories: [],
      city: undefined,
      mitStory: "",
      heroImageUrl: "",
      productPhotos: [],
      socialInstagram: "",
      socialThreads: "",
      socialFacebook: "",
      purchaseWebsite: "",
      purchasePinkoi: "",
      purchaseShopee: "",
      purchaseMyship: "",
      otherUrls: [],
      pdpaConsent: false,
      marketingEmailOptIn: false,
      turnstileToken: "",
      honeypot: "",
    },
    mode: "onTouched",
  });

  const contextValue = useMemo(
    () => ({ form, subcategorySuggestions, uploadSessionId }),
    [form, subcategorySuggestions, uploadSessionId],
  );

  const validateStep = useCallback(
    async (stepKey: SubmissionWizardStepKey) => {
      const sectionFields = SUBMISSION_SECTION_FIELDS[stepKey] ?? [];
      let isValid = await form.trigger(sectionFields);
      if (stepKey === "media" && !form.getValues("heroImageUrl")) {
        form.setError("heroImageUrl", { type: "required" });
        isValid = false;
      }
      return isValid;
    },
    [form],
  );

  const {
    activeStep,
    completedSteps,
    currentStepKey,
    navigateTo,
    goToStep,
    continueToNext,
    goBack,
  } = useWizardController({
    steps: SUBMISSION_WIZARD_STEPS,
    validateStep,
  });

  const handleStepClick = useCallback(
    async (targetStep: number) => {
      const previousStep = currentStepKey;
      if ((await goToStep(targetStep)) && targetStep > activeStep) {
        stepCompleted(previousStep);
      }
    },
    [activeStep, currentStepKey, goToStep, stepCompleted],
  );

  const handleContinue = useCallback(async () => {
    const previousStep = currentStepKey;
    if (await continueToNext()) stepCompleted(previousStep);
  }, [continueToNext, currentStepKey, stepCompleted]);

  const submitForm = useCallback(
    async (values: SubmissionWizardValues) => {
      if (isSubmitting) return;

      setSubmitError(null);
      setIsSubmitting(true);
      try {
        const result = await submitOwnerDetailedBrand(
          values,
          idempotencyKeyRef.current,
        );
        if (result?.error) {
          setSubmitError(result.error);
          return;
        }

        stepCompleted(currentStepKey);
        trackSubmissionCompleted(
          values.name,
          values.categorySlug ?? "",
          Boolean(values.heroImageUrl),
          complete(),
          "owner_claim",
        );

        const params = new URLSearchParams({ intent: "owner_claim" });
        if (result?.ownershipAdjusted) {
          params.set("ownership", "community");
        }
        router.push(`${routes.submit.confirmation()}?${params.toString()}`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [complete, currentStepKey, isSubmitting, router, stepCompleted],
  );

  const handlePublish = useCallback(async () => {
    const result = submissionFormSchema.safeParse(form.getValues());
    if (!result.success) {
      const invalidFields = result.error.issues
        .map((issue) => issue.path.at(0))
        .filter(
          (field): field is keyof SubmissionWizardValues =>
            typeof field === "string",
        );

      for (const field of invalidFields) {
        form.setError(field, { type: "validation" });
      }

      const firstInvalidField = invalidFields.at(0);
      if (firstInvalidField) {
        navigateTo(FIELD_STEPS[firstInvalidField] ?? 0);
      }
      return;
    }

    await submitForm(result.data);
  }, [form, navigateTo, submitForm]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handlePublish();
    },
    [handlePublish],
  );

  const section = (() => {
    switch (currentStepKey) {
      case "media":
        return <MediaSection />;
      case "links":
        return <LinksSection />;
      case "basicInfo":
        return <BasicInfoSection />;
    }
  })();

  return (
    <SubmissionWizardContext.Provider value={contextValue}>
      <form onSubmit={onSubmit} noValidate>
        <div className="flex min-h-screen gap-6">
          <WizardSidebar
            steps={SIDEBAR_STEPS}
            activeStep={activeStep}
            completedSteps={completedSteps}
            onStepClick={(targetStep) => void handleStepClick(targetStep)}
          />

          <main className="min-w-0 flex-1 pb-20">
            {section}

            {activeStep === SUBMISSION_WIZARD_STEPS.length - 1 ? (
              <>
                <div className="mt-6 space-y-4 rounded-surface border border-rule bg-surface p-6">
                  <Controller
                    name="pdpaConsent"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <div className="space-y-1">
                        <Label className="flex min-h-12 cursor-pointer items-start gap-3">
                          <Checkbox
                            id="submission-pdpa"
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              field.onChange(checked)
                            }
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
                          <p className="type-metadata text-danger">
                            {t("validation.pdpaRequired")}
                          </p>
                        ) : null}
                      </div>
                    )}
                  />

                  <Controller
                    name="marketingEmailOptIn"
                    control={form.control}
                    render={({ field }) => (
                      <MarketingEmailOptInField
                        id="submission-marketing-email"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />

                  <HoneypotField {...form.register("honeypot")} />

                  <div className="flex justify-center">
                    <TurnstileWidget
                      onSuccess={(token) => {
                        setTurnstileError(false);
                        form.setValue("turnstileToken", token, {
                          shouldValidate: true,
                        });
                      }}
                      onError={() => setTurnstileError(true)}
                      onExpire={() => {
                        form.setValue("turnstileToken", "", {
                          shouldValidate: true,
                        });
                      }}
                    />
                  </div>
                  {turnstileError || form.formState.errors.turnstileToken ? (
                    <p
                      className="type-metadata text-danger text-center"
                      role="alert"
                    >
                      {turnstileError
                        ? t("errors.turnstileError")
                        : t("validation.turnstileRequired")}
                    </p>
                  ) : null}

                  {submitError ? (
                    <p
                      className="type-metadata text-danger"
                      role="alert"
                      aria-live="polite"
                    >
                      {submitError}
                    </p>
                  ) : null}
                </div>

                <footer className="mt-8 flex items-center justify-between border-t border-rule pt-6">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={goBack}
                  >
                    {t("submissionWizard.backButton")}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {t("submissionWizard.submittingButton")}
                      </>
                    ) : (
                      t("submissionWizard.submitButton")
                    )}
                  </Button>
                </footer>
              </>
            ) : (
              <WizardFooter
                activeStep={activeStep}
                totalSteps={SUBMISSION_WIZARD_STEPS.length}
                isSaving={false}
                onBack={goBack}
                onSaveAndContinue={() => void handleContinue()}
                onSave={() => undefined}
                onPublish={() => undefined}
              />
            )}
          </main>
        </div>
      </form>
    </SubmissionWizardContext.Provider>
  );
}
