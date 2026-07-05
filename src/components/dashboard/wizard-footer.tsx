'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

type WizardFooterProps = {
  activeStep: number
  totalSteps: number
  isSaving: boolean
  onBack: () => void
  onSaveAndContinue: () => void
  onSaveDraft: () => void
  onPublish: () => void
}

export function WizardFooter({
  activeStep,
  totalSteps,
  isSaving,
  onBack,
  onSaveAndContinue,
  onSaveDraft,
  onPublish,
}: WizardFooterProps) {
  const t = useTranslations('dashboard.edit')
  const isFinalStep = activeStep === totalSteps - 1
  const primaryButtonClassName =
    'min-h-12 bg-cta px-6 text-cta-foreground hover:bg-cta/90 focus-visible:ring-2 focus-visible:ring-primary'

  return (
    <footer className="mt-8 flex items-center justify-between border-t border-border pt-6">
      <div>
        {isFinalStep ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 px-4 focus-visible:ring-2 focus-visible:ring-primary"
            disabled={isSaving}
            onClick={onSaveDraft}
          >
            {t('wizardSaveDraft')}
          </Button>
        ) : activeStep > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-12 px-4 focus-visible:ring-2 focus-visible:ring-primary"
            disabled={isSaving}
            onClick={onBack}
          >
            {t('wizardBack')}
          </Button>
        ) : null}
      </div>

      {isFinalStep ? (
        <Button
          type="button"
          className={primaryButtonClassName}
          disabled={isSaving}
          onClick={onPublish}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('wizardPublish')}
        </Button>
      ) : (
        <Button
          type="button"
          className={primaryButtonClassName}
          disabled={isSaving}
          onClick={onSaveAndContinue}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('wizardSaveAndContinue')}
        </Button>
      )}
    </footer>
  )
}
