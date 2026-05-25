'use client'

import { useState, useTransition } from 'react'
import type { TaxonomyTag } from '@/lib/types'
import type { UntaggedBrand } from '@/lib/services/taxonomy'
import { setBrandTagsAction } from '@/app/admin/actions'
import { BrandTagEditor } from './brand-tag-editor'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Props = {
  brands: UntaggedBrand[]
  allTags: TaxonomyTag[]
}

export function UntaggedBrandsSection({ brands, allTags }: Props) {
  const [editingBrand, setEditingBrand] = useState<UntaggedBrand | null>(null)
  const [, startTransition] = useTransition()

  if (brands.length === 0) return null

  async function handleSave(tagIds: string[]) {
    if (!editingBrand) return
    const formData = new FormData()
    formData.append('brandId', editingBrand.id)
    formData.append('tagIds', JSON.stringify(tagIds))
    await setBrandTagsAction(formData)
    setEditingBrand(null)
    startTransition(() => {
      window.location.reload()
    })
  }

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-heading text-xl font-semibold">Untagged Brands</h2>
        <span className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[#1A1918] text-white">
          {brands.length}
        </span>
      </div>

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">{brand.name}</TableCell>
                <TableCell>{brand.category ?? '-'}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingBrand(brand)}
                  >
                    Assign Tags
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={editingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setEditingBrand(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign Tags — {editingBrand?.name}</DialogTitle>
          </DialogHeader>
          {editingBrand && (
            <BrandTagEditor
              brand={{ id: editingBrand.id, name: editingBrand.name, tags: [] }}
              allTags={allTags}
              onSave={handleSave}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
