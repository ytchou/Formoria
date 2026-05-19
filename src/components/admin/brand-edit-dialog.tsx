'use client'

import { useState, useEffect, useTransition } from 'react'
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
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (brand) {
      setName(brand.name)
      setDescription(brand.description ?? '')
      setCategory(brand.category ?? '')
      setError(null)
    }
  }, [brand])

  function handleSave() {
    if (!brand) return
    startTransition(async () => {
      setError(null)
      const result = await updateBrandAction(brand.id, {
        name,
        description,
        category: category || undefined,
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
            <Input
              id="brand-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
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
