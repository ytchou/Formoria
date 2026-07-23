'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import {
  BRAND_DRAFT_PROGRESS_KEY,
  getBrandDraft,
  saveDraft,
} from '@/lib/services/brands'
import { WIZARD_STEPS } from '@/lib/schemas/brand-edit'
import type { Brand, RetailLocation } from '@/lib/types'
import {
  normalizeRetailLocations,
  reconcileRetailLocationConfirmations,
} from '@/lib/brands/locations'

type LegacyLocationBrand = Brand & { retailLocations?: unknown }
type BrandDraftUpdate = Partial<Brand> & { retailLocations?: RetailLocation[] }

type SaveSectionDraftResult = {
  success?: true
  error?: string
}

function getCompletedSteps(snapshot: Record<string, unknown> | null): number[] {
  const value = snapshot?.[BRAND_DRAFT_PROGRESS_KEY]
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.filter(
        (step): step is number => Number.isInteger(step) && step >= 0,
      ),
    ),
  ).sort((left, right) => left - right)
}

function normalizeSectionData(
  sectionData: Record<string, unknown>,
  existingReputation: unknown,
): BrandDraftUpdate {
  const { reputationSources, ...data } = sectionData
  if (
    typeof data.reputationSummary !== 'string' &&
    !Array.isArray(reputationSources)
  ) {
    return data as Partial<Brand>
  }

  const previous =
    existingReputation &&
    typeof existingReputation === 'object' &&
    !Array.isArray(existingReputation)
      ? existingReputation
      : {}
  const sources = Array.isArray(reputationSources)
    ? reputationSources.flatMap((source) => {
        if (
          !source ||
          typeof source !== 'object' ||
          Array.isArray(source) ||
          typeof (source as Record<string, unknown>).url !== 'string'
        ) {
          return []
        }
        const url = (source as Record<string, unknown>).url as string
        return url.trim() ? [{ url }] : []
      })
    : []

  return {
    ...(data as Partial<Brand>),
    reputationSummary: {
      ...previous,
      text: typeof data.reputationSummary === 'string' ? data.reputationSummary : '',
      sources,
    },
  }
}

export async function saveSectionDraftAction(
  brandId: string,
  brandSlug: string,
  sectionKey: string,
  sectionData: Record<string, unknown>
): Promise<SaveSectionDraftResult>
export async function saveSectionDraftAction(
  brandId: string,
  sectionKey: string,
  sectionData: Record<string, unknown>
): Promise<SaveSectionDraftResult>
export async function saveSectionDraftAction(
  brandId: string,
  brandSlugOrSectionKey: string,
  sectionKeyOrSectionData: string | Record<string, unknown>,
  sectionData?: Record<string, unknown>
): Promise<SaveSectionDraftResult> {
  try {
    if (typeof sectionKeyOrSectionData !== 'string' || !sectionData) {
      return { error: 'Unauthorized' }
    }

    const brandSlug = brandSlugOrSectionKey
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return { error: 'Unauthorized' }
    }

    const editor = await requireBrandEditor(brandSlug)
    if ('error' in editor || editor.brand.id !== brandId) {
      return { error: 'Unauthorized' }
    }

    const existingDraft = await getBrandDraft(brandId)
    const existingReputation =
      existingDraft?.reputationSummary ?? editor.brand.reputationSummary
    let normalizedSectionData = normalizeSectionData(
      sectionData,
      existingReputation,
    )
    if (
      Object.prototype.hasOwnProperty.call(
        normalizedSectionData,
        'retailLocations',
      )
    ) {
      normalizedSectionData = {
        ...normalizedSectionData,
        retailLocations: reconcileRetailLocationConfirmations({
          previous: normalizeRetailLocations(
            (editor.brand as LegacyLocationBrand).retailLocations,
          ),
          next: normalizeRetailLocations(normalizedSectionData.retailLocations),
          isActualOwner: editor.owner,
        }),
      }
    }
    const stepIndex = WIZARD_STEPS.findIndex(
      (step) => step.key === sectionKeyOrSectionData,
    )
    const completedSteps = getCompletedSteps(existingDraft)
    const mergedData = {
      ...(existingDraft ?? {}),
      ...normalizedSectionData,
      ...(stepIndex >= 0
        ? {
            [BRAND_DRAFT_PROGRESS_KEY]: Array.from(
              new Set([...completedSteps, stepIndex]),
            ).sort((left, right) => left - right),
          }
        : {}),
    }

    await saveDraft(brandId, mergedData as Partial<Brand>)
    revalidatePath(`/dashboard/brands/${brandSlug}`)

    return { success: true }
  } catch (error) {
    console.error('[brand-edit-wizard:saveSectionDraftAction]', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to save changes',
    }
  }
}
