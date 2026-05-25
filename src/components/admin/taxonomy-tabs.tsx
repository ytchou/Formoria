'use client'

import { useState, useTransition } from 'react'
import type { TaxonomyTag } from '@/lib/types'
import type { BrandForReview } from '@/lib/services/taxonomy'
import { TagManager } from '@/components/admin/tag-manager'
import { TagReviewQueue } from '@/components/admin/tag-review-queue'
import { BrandTagEditor } from '@/components/admin/brand-tag-editor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { confirmBrandTagsAction, approveSuggestedTagAction, processSuggestedTagAction } from '@/app/admin/actions'
import { cn } from '@/lib/utils'

type Tab = 'tags' | 'review' | 'suggested'

interface Props {
  tags: TaxonomyTag[]
  brandsForReview: BrandForReview[]
}

export function TaxonomyTabs({ tags, brandsForReview }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('tags')
  const [editingBrand, setEditingBrand] = useState<BrandForReview | null>(null)
  const [isPending, startTransition] = useTransition()

  const suggestedTags = tags.filter((t) => t.suggestedBy !== null && t.isActive)

  function handleConfirm(brandId: string, tagIds: string[]) {
    startTransition(async () => {
      const formData = new FormData()
      formData.append('brandId', brandId)
      formData.append('tagIds', JSON.stringify(tagIds))
      await confirmBrandTagsAction(formData)
    })
  }

  async function handleEditorSave(tagIds: string[]) {
    if (!editingBrand) return
    const formData = new FormData()
    formData.append('brandId', editingBrand.id)
    formData.append('tagIds', JSON.stringify(tagIds))
    await confirmBrandTagsAction(formData)
    setEditingBrand(null)
  }

  function handleApproveSuggestion(tagId: string) {
    startTransition(async () => {
      await approveSuggestedTagAction(tagId)
    })
  }

  function handleRejectSuggestion(tagId: string) {
    startTransition(async () => {
      const formData = new FormData()
      formData.append('submissionId', tagId)
      formData.append('action', 'reject')
      await processSuggestedTagAction(formData)
    })
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'tags', label: 'Tags' },
    { id: 'review', label: 'Review Queue', badge: brandsForReview.length },
    { id: 'suggested', label: 'Suggested Tags', badge: suggestedTags.length },
  ]

  return (
    <>
      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 border-b border-[#E5E4E1]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-b-2 border-[#1A1918] text-[#1A1918]'
                : 'text-[#7C7570] hover:text-[#1A1918]'
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-[#1A1918] px-2 py-0.5 text-[11px] font-medium text-white">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tags tab */}
      {activeTab === 'tags' && <TagManager tags={tags} />}

      {/* Review Queue tab */}
      {activeTab === 'review' && (
        <TagReviewQueue
          brands={brandsForReview}
          allTags={tags}
          onConfirm={handleConfirm}
          onEdit={(brand) => setEditingBrand(brand)}
        />
      )}

      {/* Suggested Tags tab */}
      {activeTab === 'suggested' && (
        <div className="space-y-4">
          {suggestedTags.length === 0 ? (
            <p className="text-sm text-[#7C7570]">No suggested tags pending review.</p>
          ) : (
            <div className="divide-y divide-[#E5E4E1] rounded-lg border border-[#E5E4E1]">
              {suggestedTags.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#1A1918]">{tag.name}</span>
                    {tag.nameZh && (
                      <span className="text-sm text-[#7C7570]">({tag.nameZh})</span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-[#E06B3F] bg-[#FDF3EC] px-2 py-0.5 text-[11px] font-medium text-[#E06B3F]">
                      suggested
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleApproveSuggestion(tag.id)}
                      className="rounded-md border border-[#1A1918] px-3 py-1.5 text-xs font-medium text-[#1A1918] transition-colors hover:bg-[#1A1918] hover:text-white disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRejectSuggestion(tag.id)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-[#D94F3D] transition-colors hover:bg-[#FDF3EC] disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BrandTagEditor dialog (opened from Review Queue → Edit) */}
      {editingBrand && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setEditingBrand(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Tags — {editingBrand.name}</DialogTitle>
            </DialogHeader>
            <BrandTagEditor
              brand={editingBrand}
              allTags={tags}
              onSave={handleEditorSave}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
