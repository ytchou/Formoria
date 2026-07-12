'use client'

import { useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
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
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

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
  const [socialInstagram, setSocialInstagram] = useState(brand?.socialInstagram ?? '')
  const [socialThreads, setSocialThreads] = useState(brand?.socialThreads ?? '')
  const [socialFacebook, setSocialFacebook] = useState(brand?.socialFacebook ?? '')
  const [purchaseWebsite, setPurchaseWebsite] = useState(brand?.purchaseWebsite ?? '')
  const [purchasePinkoi, setPurchasePinkoi] = useState(brand?.purchasePinkoi ?? '')
  const [purchaseShopee, setPurchaseShopee] = useState(brand?.purchaseShopee ?? '')
  const [otherUrls, setOtherUrls] = useState<Brand['otherUrls']>(brand?.otherUrls ?? [])
  const [productType, setProductType] = useState(() => {
    const productTypeSlug = (brand as (Brand & { product_type?: string | null }) | null)?.product_type
    const match = PRODUCT_TYPE_CATEGORIES.find(
      (c) =>
        c.slug === productTypeSlug ||
        c.slug === brand?.category ||
        c.nameZh === brand?.category ||
        c.name === brand?.category
    )
    return match?.slug ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function emptyToNull(value: string) {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  function addOtherUrl() {
    setOtherUrls((current) => [...current, { label: '', url: '' }])
  }

  function updateOtherUrl(index: number, url: string) {
    setOtherUrls((current) =>
      current.map((link, linkIndex) => (linkIndex === index ? { ...link, url } : link))
    )
  }

  function removeOtherUrl(index: number) {
    setOtherUrls((current) => current.filter((_, linkIndex) => linkIndex !== index))
  }

  function handleSave() {
    if (!brand) return
    startTransition(async () => {
      setError(null)
      const data: Parameters<typeof updateBrandAction>[1] = {
        name,
        description,
        productType: productType || undefined,
        socialInstagram: emptyToNull(socialInstagram),
        socialThreads: emptyToNull(socialThreads),
        socialFacebook: emptyToNull(socialFacebook),
        purchaseWebsite: emptyToNull(purchaseWebsite),
        purchasePinkoi: emptyToNull(purchasePinkoi),
        purchaseShopee: emptyToNull(purchaseShopee),
        otherUrls: otherUrls
          .map((link) => ({ ...link, url: link.url.trim() }))
          .filter((link) => link.url !== ''),
      }
      const result = await updateBrandAction(brand.id, data)
      if (result?.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
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
              className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-description">Description</Label>
            <Textarea
              id="brand-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-product-type">Product Type</Label>
            <NativeSelect
              id="brand-product-type"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
            >
              <option value="">—</option>
              {PRODUCT_TYPE_CATEGORIES.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.nameZh} ({cat.name})
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-4 border-t border-border pt-4">
            <div className="space-y-1">
              <h3 className="type-subsection-title">Links</h3>
            </div>

            <div className="space-y-3">
              <h4 className="type-eyebrow-muted">
                Social
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="brand-social-instagram">Instagram</Label>
                  <Input
                    id="brand-social-instagram"
                    type="url"
                    placeholder="Instagram URL"
                    value={socialInstagram}
                    onChange={(e) => setSocialInstagram(e.target.value)}
                    className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-social-threads">Threads</Label>
                  <Input
                    id="brand-social-threads"
                    type="url"
                    placeholder="Threads URL"
                    value={socialThreads}
                    onChange={(e) => setSocialThreads(e.target.value)}
                    className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-social-facebook">Facebook</Label>
                  <Input
                    id="brand-social-facebook"
                    type="url"
                    placeholder="Facebook URL"
                    value={socialFacebook}
                    onChange={(e) => setSocialFacebook(e.target.value)}
                    className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="type-eyebrow-muted">
                Purchase
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="brand-purchase-website">Website</Label>
                  <Input
                    id="brand-purchase-website"
                    type="url"
                    placeholder="Website URL"
                    value={purchaseWebsite}
                    onChange={(e) => setPurchaseWebsite(e.target.value)}
                    className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-purchase-pinkoi">Pinkoi</Label>
                  <Input
                    id="brand-purchase-pinkoi"
                    type="url"
                    placeholder="Pinkoi URL"
                    value={purchasePinkoi}
                    onChange={(e) => setPurchasePinkoi(e.target.value)}
                    className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-purchase-shopee">Shopee</Label>
                  <Input
                    id="brand-purchase-shopee"
                    type="url"
                    placeholder="Shopee URL"
                    value={purchaseShopee}
                    onChange={(e) => setPurchaseShopee(e.target.value)}
                    className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="type-eyebrow-muted">
                Other URLs
              </h4>
              <div className="space-y-2">
                {otherUrls.map((link, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_48px]">
                    <Input
                      type="url"
                      aria-label={`Other URL ${index + 1}`}
                      placeholder="URL"
                      value={link.url}
                      onChange={(e) => updateOtherUrl(index, e.target.value)}
                      className="h-12 focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove URL ${index + 1}`}
                      onClick={() => removeOtherUrl(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={addOtherUrl}
              >
                <Plus className="h-4 w-4" />
                Add URL
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
