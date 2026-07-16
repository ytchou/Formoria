'use client'

import { createContext, useContext } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import type { SubmissionWizardFormValues } from '@/lib/schemas/submission-wizard'

export type SubmissionWizardValues = SubmissionWizardFormValues & {
  pdpaConsent: boolean
  marketingEmailOptIn: boolean
  turnstileToken: string
  honeypot: string
}

type SubmissionWizardContextValue = {
  form: UseFormReturn<SubmissionWizardValues>
  productTagSuggestions: string[]
  uploadSessionId: string
}

export const SubmissionWizardContext =
  createContext<SubmissionWizardContextValue | null>(null)

export function useSubmissionWizard() {
  const context = useContext(SubmissionWizardContext)

  if (!context) {
    throw new Error(
      'useSubmissionWizard must be used within SubmissionWizardContext',
    )
  }

  return context
}
