"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateBrandAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploadField } from "@/components/forms/image-upload-field";
import { DynamicArrayField } from "@/components/forms/dynamic-array-field";
import { ProductPhotosField } from "@/components/forms/product-photos-field";
import type { Brand } from "@/lib/types";

type BrandEditFormProps = {
  brand: Brand;
};

export function BrandEditForm({ brand }: BrandEditFormProps) {
  const [state, action, pending] = useActionState(updateBrandAction, undefined);

  return (
    <div className="space-y-10">
      {state?.error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <form action={action} className="space-y-10">
        <input type="hidden" name="brandSlug" value={brand.slug} />

        {/* Basic Info */}
        <section id="basic-info" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            Basic Info
          </h2>

          <div className="space-y-2">
            <Label htmlFor="name">品牌名稱</Label>
            <Input
              id="name"
              name="name"
              defaultValue={brand.name}
              required
            />
            {state?.fieldErrors?.name && (
              <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              defaultValue={brand.description ?? ""}
            />
            {state?.fieldErrors?.description && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="brandHighlights">品牌亮點</Label>
            <textarea
              id="brandHighlights"
              name="brandHighlights"
              maxLength={300}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              defaultValue={brand.brandHighlights ?? ""}
            />
            <p className="text-xs text-muted-foreground">最多 300 字</p>
            {state?.fieldErrors?.brandHighlights && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.brandHighlights}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="foundingYear">Founding Year</Label>
            <Input
              id="foundingYear"
              name="foundingYear"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              defaultValue={brand.foundingYear ?? ""}
            />
          </div>
        </section>

        {/* Media */}
        <section id="media" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            Media
          </h2>

          <ImageUploadField
            name="logoUrl"
            label="Logo"
            brandId={brand.id}
            currentUrl={brand.logoUrl}
          />

          <ImageUploadField
            name="heroImageUrl"
            label="Hero Image"
            brandId={brand.id}
            currentUrl={brand.heroImageUrl}
          />

          <div className="space-y-2">
            <Label htmlFor="productPhotos">產品照片</Label>
            <ProductPhotosField
              name="productPhotos"
              brandId={brand.id}
              defaultPhotos={brand.productPhotos ?? []}
            />
          </div>
        </section>

        {/* Links */}
        <section id="links" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            Links
          </h2>

          <div className="space-y-2">
            <Label htmlFor="websiteUrl">Official Website</Label>
            <Input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              placeholder="https://yourbrand.com"
              defaultValue={brand.socialLinks.officialWebsite ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram</Label>
            <Input
              id="instagram"
              name="instagram"
              placeholder="@yourbrand"
              defaultValue={brand.socialLinks.instagram ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="threads">Threads</Label>
            <Input
              id="threads"
              name="threads"
              placeholder="@yourbrand"
              defaultValue={brand.socialLinks.threads ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebook">Facebook</Label>
            <Input
              id="facebook"
              name="facebook"
              placeholder="https://facebook.com/yourbrand"
              defaultValue={brand.socialLinks.facebook ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label>Purchase Links</Label>
            <DynamicArrayField
              initialItems={brand.purchaseLinks}
              createItem={() => ({ platform: "", url: "", label: "" })}
              addLabel="Add purchase link"
              renderItem={(item, index, onRemove) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    name={`purchaseLinks[${index}].platform`}
                    placeholder="Platform"
                    defaultValue={(item as { platform: string }).platform}
                    className="w-32"
                  />
                  <Input
                    name={`purchaseLinks[${index}].url`}
                    placeholder="URL"
                    defaultValue={(item as { url: string }).url}
                  />
                  <Input
                    name={`purchaseLinks[${index}].label`}
                    placeholder="Label"
                    defaultValue={(item as { label?: string }).label ?? ""}
                    className="w-32"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                    Remove
                  </Button>
                </div>
              )}
            />
          </div>
        </section>

        {/* Locations */}
        <section id="locations" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            Locations
          </h2>

          <DynamicArrayField
            initialItems={brand.retailLocations}
            createItem={() => ({ name: "", address: "" })}
            addLabel="Add retail location"
            renderItem={(item, index, onRemove) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  name={`retailLocations[${index}].name`}
                  placeholder="Store name"
                  defaultValue={(item as { name: string }).name}
                />
                <Input
                  name={`retailLocations[${index}].address`}
                  placeholder="Address"
                  defaultValue={(item as { address: string }).address}
                />
                <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                  Remove
                </Button>
              </div>
            )}
          />
        </section>

        <div className="flex gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "儲存中..." : "儲存變更"}
          </Button>
          <Link href={`/dashboard/brands/${brand.slug}`}>
            <Button type="button" variant="outline">
              取消
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
