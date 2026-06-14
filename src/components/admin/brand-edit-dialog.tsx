'use client'

import { useState, useTransition } from 'react'
import type { Brand } from '@/lib/types'
import { updateBrandAction } from '@/app/admin/actions'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PRODUCT_TYPE_CATEGORIES, deriveCategoryFromProductTypes } from '@/lib/taxonomy/ontology'

type BrandEditDialogProps = {
  brand: Brand | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BrandEditDialog({
  brand,
  open,
  onOpenChange,
}: BrandEditDialogProps) {
  const [name, setName] = useState(brand?.name ?? '')
  const [description, setDescription] = useState(brand?.description ?? '')
  const [categorySlug, setCategorySlug] = useState(() => {
    const match = PRODUCT_TYPE_CATEGORIES.find((c) => c.nameZh === brand?.category)
    return match?.slug ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    if (!brand) return
    startTransition(async () => {
      setError(null)
      const result = await updateBrandAction(brand.id, {
        name,
        description,
        category: categorySlug ? deriveCategoryFromProductTypes([categorySlug]) ?? undefined : undefined,
      })
      if (result?.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Brand</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Name</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-description">Description</Label>
            <Textarea
              id="brand-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-category">Category</Label>
            <select
              id="brand-category"
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
            >
              <option value="">—</option>
              {PRODUCT_TYPE_CATEGORIES.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.nameZh} ({cat.name})
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-[#D94F3D]">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
