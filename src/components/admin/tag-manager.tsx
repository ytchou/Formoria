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

const CATEGORIES: TagCategory[] = ['product_type', 'value']

const CATEGORY_LABELS: Record<string, string> = {
  product_type: '產品類型',
  value: '品牌特色',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

interface TagManagerProps {
  tags: TaxonomyTag[]
}

export function TagManager({ tags }: TagManagerProps) {
  const [newTagName, setNewTagName] = useState('')
  const [newTagNameZh, setNewTagNameZh] = useState('')
  const [newTagCategory, setNewTagCategory] = useState<string>('product_type')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [mergingTagId, setMergingTagId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
        <h3 className="mb-3 text-sm font-medium text-[#7C7570]">新增標籤</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <Input
              placeholder="標籤名稱（英文）"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            />
          </div>
          <div className="flex-1">
            <Input
              placeholder="標籤名稱（中文，選填）"
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
            新增標籤
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-[#D94F3D]">{error}</p>}
      </div>

      {/* Tags Grouped by Category */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {CATEGORIES.map((category) => {
          const categoryTags = grouped[category] ?? []
          if (categoryTags.length === 0) return null

          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>{categoryLabel(category)}</span>
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
                            <span className="inline-flex items-center rounded-full bg-[#F5F4F1] px-1.5 py-0.5 text-xs font-medium text-[#7C7570]">
                              {tag.brandCount ?? 0}
                            </span>
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
                                <SelectValue placeholder="合併至..." />
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
                                  variant="outline"
                                  size="sm"
                                  className="rounded-full"
                                  onClick={() => {
                                    setEditingTagId(tag.id)
                                    setEditingName(tag.name)
                                  }}
                                >
                                  Rename
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-full"
                                  onClick={() => {
                                    setMergingTagId(tag.id)
                                    setMergeTargetId('')
                                  }}
                                >
                                  Merge
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-full text-[#D94F3D] hover:text-[#D94F3D]"
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
