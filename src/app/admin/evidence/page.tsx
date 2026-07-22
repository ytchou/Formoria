import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { EvidenceQueue } from '@/components/admin/evidence-queue'
import { requireAdminPage } from '@/lib/auth/require-admin'
import {
  listAllEvidence,
  reviewEvidence,
  type OriginEvidenceDecision,
} from '@/lib/services/origin-evidence'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.evidence')

  return { title: t('title') }
}

async function reviewEvidenceAction(
  id: string,
  decision: OriginEvidenceDecision,
  notes: string,
  tierAction?: 'strip_declaration',
): Promise<{ error?: string } | undefined> {
  'use server'

  const user = await requireAdminPage('/admin/evidence')
  const result = await reviewEvidence(id, decision, notes, {
    reviewerId: user.id,
    ...(tierAction ? { tierAction } : {}),
  })

  if (!result.ok) return { error: result.code }

  revalidatePath('/admin/evidence')
  revalidatePath('/admin')
  return undefined
}

export default async function AdminEvidencePage() {
  await requireAdminPage('/admin/evidence')
  const [evidence, t] = await Promise.all([
    listAllEvidence(),
    getTranslations('admin.evidence'),
  ])

  return (
    <div>
      <h1 className="type-page-title-large">{t('title')}</h1>
      <p className="mt-2 type-body-muted">{t('description')}</p>

      <div className="mt-8">
        <EvidenceQueue evidence={evidence} reviewAction={reviewEvidenceAction} />
      </div>
    </div>
  )
}
