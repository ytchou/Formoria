'use client'

import { useState, useTransition } from 'react'
import type { Brand, BrandStatus } from '@/lib/types'
import { StatusBadge } from './status-badge'
import { BrandEditDialog } from './brand-edit-dialog'
import { ConfirmDialog } from './confirm-dialog'
import {
  hideBrandAction,
  unhideBrandAction,
  deleteBrandAction,
} from '@/app/admin/actions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'

type TabValue = 'all' | BrandStatus

export function BrandList({ brands }: { brands: Brand[] }) {
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered =
    activeTab === 'all'
      ? brands
      : brands.filter((b) => b.status === activeTab)

  function handleHide(brand: Brand) {
    startTransition(async () => {
      setError(null)
      const result = await hideBrandAction(brand.id)
      if (result?.error) setError(result.error)
    })
  }

  function handleUnhide(brand: Brand) {
    startTransition(async () => {
      setError(null)
      const result = await unhideBrandAction(brand.id)
      if (result?.error) setError(result.error)
    })
  }

  function handleDelete() {
    if (!deletingBrand) return
    startTransition(async () => {
      setError(null)
      const result = await deleteBrandAction(deletingBrand.id)
      if (result?.error) setError(result.error)
      else setDeletingBrand(null)
    })
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList>
          <TabsTrigger value="all">All ({brands.length})</TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({brands.filter((b) => b.status === 'approved').length})
          </TabsTrigger>
          <TabsTrigger value="hidden">
            Hidden ({brands.filter((b) => b.status === 'hidden').length})
          </TabsTrigger>
          <TabsTrigger value="pending">
            Pending ({brands.filter((b) => b.status === 'pending').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <p className="mt-2 text-sm text-[#D94F3D]">{error}</p>
      )}

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">{brand.name}</TableCell>
                <TableCell>
                  <StatusBadge status={brand.status} />
                </TableCell>
                <TableCell>{brand.category ?? '-'}</TableCell>
                <TableCell>{formatDate(brand.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingBrand(brand)}
                    >
                      Edit
                    </Button>
                    {brand.status === 'approved' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleHide(brand)}
                        disabled={isPending}
                      >
                        Hide
                      </Button>
                    )}
                    {brand.status === 'hidden' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnhide(brand)}
                        disabled={isPending}
                      >
                        Unhide
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#D94F3D] hover:text-[#D94F3D]"
                      onClick={() => setDeletingBrand(brand)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-[#7C7570]"
                >
                  No brands found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <BrandEditDialog
        key={editingBrand?.id ?? 'none'}
        brand={editingBrand}
        open={editingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setEditingBrand(null)
        }}
      />

      <ConfirmDialog
        open={deletingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingBrand(null)
        }}
        title="Delete Brand"
        description="This action cannot be undone. The brand and all associated data will be permanently deleted."
        onConfirm={handleDelete}
        confirmLabel="Delete"
        variant="destructive"
        confirmText={deletingBrand?.name}
        isPending={isPending}
      />
    </div>
  )
}
