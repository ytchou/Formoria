'use client'

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import type { Brand, BrandStatus } from '@/lib/types'
import { StatusBadge } from './status-badge'
import { BrandEditDialog } from './brand-edit-dialog'
import { ConfirmDialog } from './confirm-dialog'
import {
  hideBrandAction,
  unhideBrandAction,
  deleteBrandAction,
  resyncBrandImagesAction,
  rejectMitAction,
  verifyMitAction,
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { routing } from '@/i18n/routing'
import { cn } from '@/lib/utils'

type TabValue = 'all' | BrandStatus
type MitStatus = NonNullable<Brand['mitStatus']>

const MIT_STATUS_CONFIG: Record<MitStatus, { label: string; className: string }> = {
  unverified: {
    label: 'MIT 未驗證',
    className: 'bg-[#F5F4F1] text-[#7C7570]',
  },
  claimed: {
    label: 'MIT 待審核',
    className: 'bg-[#F5F4F1] text-[#7C7570]',
  },
  verified: {
    label: 'MIT 已驗證',
    className: 'bg-[#EAF3E8] text-[#2D5A27]',
  },
  rejected: {
    label: 'MIT 已拒絕',
    className: 'bg-[#FDF3EC] text-[#D94F3D]',
  },
}

function getMitStatus(brand: Brand): MitStatus {
  if (brand.mitStatus) return brand.mitStatus
  return brand.mitVerified ? 'verified' : 'unverified'
}

function MitStatusBadge({ status }: { status: MitStatus }) {
  const config = MIT_STATUS_CONFIG[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      {config.label}
    </span>
  )
}

export function BrandList({ brands }: { brands: Brand[] }) {
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null)
  const [mitRejectingBrandId, setMitRejectingBrandId] = useState<string | null>(null)
  const [mitRejectNotes, setMitRejectNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  function handleResyncImages(brand: Brand) {
    startTransition(async () => {
      setError(null)
      setNotice(null)
      const result = await resyncBrandImagesAction(brand.id)
      if (result.error) setError(result.error)
      else setNotice(`${brand.name}: synced ${result.synced ?? 0} image(s)${result.failed ? `, ${result.failed} failed` : ''}`)
    })
  }

  function handleVerifyMit(brand: Brand) {
    startTransition(async () => {
      setError(null)
      const result = await verifyMitAction(brand.id, brand.mitEvidence?.mit_smile_cert)
      if (result?.error) setError(result.error)
    })
  }

  function handleRejectMit(brand: Brand) {
    if (mitRejectingBrandId !== brand.id) {
      setMitRejectingBrandId(brand.id)
      setMitRejectNotes('')
      setError(null)
      return
    }

    const notes = mitRejectNotes.trim()
    if (!notes) {
      setError('Rejection notes are required.')
      return
    }

    startTransition(async () => {
      setError(null)
      const result = await rejectMitAction(brand.id, notes)
      if (result?.error) setError(result.error)
      else {
        setMitRejectingBrandId(null)
        setMitRejectNotes('')
      }
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
          <TabsTrigger value="all">全部 ({brands.length})</TabsTrigger>
          <TabsTrigger value="approved">
            已核准 ({brands.filter((b) => b.status === 'approved').length})
          </TabsTrigger>
          <TabsTrigger value="hidden">
            已隱藏 ({brands.filter((b) => b.status === 'hidden').length})
          </TabsTrigger>
          <TabsTrigger value="pending">
            待審核 ({brands.filter((b) => b.status === 'pending').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <p className="mt-2 text-sm text-[#D94F3D]">{error}</p>
      )}
      {notice && (
        <p className="mt-2 text-sm text-amber-600">{notice}</p>
      )}

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>品牌</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>MIT</TableHead>
              <TableHead>分類</TableHead>
              <TableHead>建立日期</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((brand) => (
              <Fragment key={brand.id}>
                <TableRow>
                  <TableCell className="font-medium">
                    {brand.name}
                    {brand.isDemo && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-[#EDE8F5] px-2 py-0.5 text-[11px] font-medium text-[#6B47B8]">
                        Demo
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={brand.status} />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <MitStatusBadge status={getMitStatus(brand)} />
                      {brand.mitEvidence?.mit_smile_cert && (
                        <p className="text-xs text-[#7C7570]">
                          Cert: {brand.mitEvidence.mit_smile_cert}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{brand.category ?? '-'}</TableCell>
                  <TableCell>{formatDate(brand.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingBrand(brand)}
                        >
                          編輯
                        </Button>
                        <Link
                          href={`/${routing.defaultLocale}/dashboard/brands/${brand.slug}`}
                          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        >
                          以擁有者身分檢視
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleVerifyMit(brand)}
                          disabled={isPending}
                        >
                          Verify MIT
                        </Button>
                        <Button
                          variant={mitRejectingBrandId === brand.id ? 'destructive' : 'ghost'}
                          size="sm"
                          className={
                            mitRejectingBrandId === brand.id
                              ? undefined
                              : 'text-[#D94F3D] hover:text-[#D94F3D]'
                          }
                          onClick={() => handleRejectMit(brand)}
                          disabled={isPending}
                        >
                          {mitRejectingBrandId === brand.id
                            ? 'Confirm reject MIT'
                            : 'Reject MIT'}
                        </Button>
                        {brand.status === 'approved' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleHide(brand)}
                            disabled={isPending}
                          >
                            隱藏
                          </Button>
                        )}
                        {brand.status === 'hidden' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnhide(brand)}
                            disabled={isPending}
                          >
                            取消隱藏
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResyncImages(brand)}
                          disabled={isPending}
                        >
                          Re-sync images
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[#D94F3D] hover:text-[#D94F3D]"
                          onClick={() => setDeletingBrand(brand)}
                        >
                          刪除
                        </Button>
                      </div>
                      {mitRejectingBrandId === brand.id && (
                        <div className="w-full max-w-sm">
                          <Textarea
                            autoFocus
                            placeholder="Why are you rejecting this MIT verification?"
                            value={mitRejectNotes}
                            onChange={(event) => setMitRejectNotes(event.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-[#7C7570]"
                >
                  找不到品牌。
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
        title="刪除品牌"
        description="此操作無法撤銷。品牌及其所有關聯資料將被永久刪除。"
        onConfirm={handleDelete}
        confirmLabel="刪除"
        variant="destructive"
        confirmText={deletingBrand?.name}
        isPending={isPending}
      />
    </div>
  )
}
