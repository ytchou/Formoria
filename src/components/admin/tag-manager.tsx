'use client'

import { useState, useTransition } from 'react'
import type { TaxonomyTag, TagCategory } from '@/lib/types'
import {
  createTagAction,
  renameTagAction,
  mergeTagAction,
  deactivateTagAction,
} from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

const CATEGORIES: TagCategory[] = ['product_type', 'material', 'price_range', 'region', 'value']

function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function TagManager({ tags }: { tags: TaxonomyTag[] }) {
  const [newTagName, setNewTagName] = useState('')
  const [newTagNameZh, setNewTagNameZh] = useState('')
  const [newTagCategory, setNewTagCategory] = useState<string>('product_type')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [mergingTagId, setMergingTagId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const suggestedTags = tags.filter((t) => t.suggestedBy !== null && t.isActive)

  const grouped = CATEGORIES.reduce<Record<string, TaxonomyTag[]>>(
    (acc, category) => {
      acc[category] = tags.filter((t) => t.category === category)
      return acc
    },
    {}
  )

  function handleAddTag() {
    if (!newTagName.trim()) return
    startTransition(async () => {
      setError(null)
      const result = await createTagAction({
        name: newTagName.trim(),
        category: newTagCategory,
        nameZh: newTagNameZh.trim() || undefined,
      })
      if (result?.error) setError(result.error)
      else {
        setNewTagName('')
        setNewTagNameZh('')
      }
    })
  }

  function handleRename(tagId: string) {
    if (!editingName.trim()) return
    startTransition(async () => {
      setError(null)
      const result = await renameTagAction(tagId, editingName.trim())
      if (result?.error) setError(result.error)
      else setEditingTagId(null)
    })
  }

  function handleMerge(sourceId: string) {
    if (!mergeTargetId) return
    startTransition(async () => {
      setError(null)
      const result = await mergeTagAction(sourceId, mergeTargetId)
      if (result?.error) setError(result.error)
      else {
        setMergingTagId(null)
        setMergeTargetId('')
      }
    })
  }

  function handleDeactivate(tagId: string) {
    startTransition(async () => {
      setError(null)
      const result = await deactivateTagAction(tagId)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-8">
      {/* Add Tag Form */}
      <div className="rounded-lg bg-[#F5F4F1] p-4">
        <h3 className="mb-3 text-sm font-medium text-[#7C7570]">Add New Tag</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <Input
              placeholder="Tag name (English)"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            />
          </div>
          <div className="flex-1">
            <Input
              placeholder="Tag name (Chinese, optional)"
              value={newTagNameZh}
              onChange={(e) => setNewTagNameZh(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Select value={newTagCategory} onValueChange={(v) => v && setNewTagCategory(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {categoryLabel(cat)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAddTag} disabled={isPending || !newTagName.trim()}>
            Add Tag
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-[#D94F3D]">{error}</p>}
      </div>

      {/* Suggested Tags Section */}
      {suggestedTags.length > 0 && (
        <div>
          <h3 className="text-lg font-medium">
            Suggested Tags ({suggestedTags.length})
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestedTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E06B3F] bg-[#FDF3EC] px-3 py-1 text-sm"
              >
                {tag.name}
                {tag.nameZh && (
                  <span className="text-[#7C7570]">({tag.nameZh})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tags Grouped by Category */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {CATEGORIES.map((category) => {
          const categoryTags = grouped[category] ?? []
          if (categoryTags.length === 0) return null

          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>{category}</span>
                  <span className="inline-flex items-center rounded-full bg-[#F5F4F1] px-2 py-0.5 text-xs font-medium text-[#7C7570]">
                    {categoryTags.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categoryTags.map((tag) => (
                    <div
                      key={tag.id}
                      className={cn(
                        'flex items-center justify-between rounded-md px-3 py-2',
                        !tag.isActive && 'opacity-50'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {editingTagId === tag.id ? (
                          <Input
                            className="h-7 w-32"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(tag.id)
                              if (e.key === 'Escape') setEditingTagId(null)
                            }}
                            onBlur={() => handleRename(tag.id)}
                            autoFocus
                          />
                        ) : (
                          <>
                            <span
                              className={cn(
                                'text-sm font-medium',
                                !tag.isActive && 'line-through'
                              )}
                            >
                              {tag.name}
                            </span>
                            {tag.nameZh && (
                              <span className="text-sm text-[#7C7570]">
                                {tag.nameZh}
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {mergingTagId === tag.id ? (
                          <div className="flex items-center gap-1">
                            <Select
                              value={mergeTargetId}
                              onValueChange={(v) => v && setMergeTargetId(v)}
                            >
                              <SelectTrigger className="h-7 w-28 text-xs">
                                <SelectValue placeholder="Merge into..." />
                              </SelectTrigger>
                              <SelectContent>
                                {categoryTags
                                  .filter(
                                    (t) =>
                                      t.id !== tag.id && t.isActive
                                  )
                                  .map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleMerge(tag.id)}
                              disabled={isPending || !mergeTargetId}
                            >
                              Go
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setMergingTagId(null)
                                setMergeTargetId('')
                              }}
                            >
                              X
                            </Button>
                          </div>
                        ) : (
                          <>
                            {tag.isActive && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setEditingTagId(tag.id)
                                    setEditingName(tag.name)
                                  }}
                                >
                                  Rename
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setMergingTagId(tag.id)
                                    setMergeTargetId('')
                                  }}
                                >
                                  Merge
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-[#D94F3D]"
                                  onClick={() => handleDeactivate(tag.id)}
                                  disabled={isPending}
                                >
                                  Deactivate
                                </Button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
