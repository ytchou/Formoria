"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateBrandAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BrandEditFormProps = {
  brandSlug: string;
  defaultValues: {
    name: string;
    description: string;
    websiteUrl: string;
    instagram: string;
    threads: string;
    facebook: string;
  };
};

export function BrandEditForm({ brandSlug, defaultValues }: BrandEditFormProps) {
  const [state, action, pending] = useActionState(updateBrandAction, undefined);

  return (
    <div className="space-y-6">
      {state?.error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <form action={action} className="space-y-6">
        <input type="hidden" name="brandSlug" value={brandSlug} />

        <div className="space-y-2">
          <Label htmlFor="name">品牌名稱</Label>
          <Input
            id="name"
            name="name"
            defaultValue={defaultValues.name}
            required
          />
          {state?.fieldErrors?.name && (
            <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">品牌介紹</Label>
          <textarea
            id="description"
            name="description"
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            defaultValue={defaultValues.description}
          />
          {state?.fieldErrors?.description && (
            <p className="text-xs text-destructive">
              {state.fieldErrors.description}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium">社群連結</h3>

          <div className="space-y-2">
            <Label htmlFor="websiteUrl">官方網站</Label>
            <Input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              placeholder="https://yourbrand.com"
              defaultValue={defaultValues.websiteUrl}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram</Label>
            <Input
              id="instagram"
              name="instagram"
              placeholder="@yourbrand"
              defaultValue={defaultValues.instagram}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="threads">Threads</Label>
            <Input
              id="threads"
              name="threads"
              placeholder="@yourbrand"
              defaultValue={defaultValues.threads}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebook">Facebook</Label>
            <Input
              id="facebook"
              name="facebook"
              placeholder="https://facebook.com/yourbrand"
              defaultValue={defaultValues.facebook}
            />
          </div>
        </div>

        <div className="flex gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "儲存中..." : "儲存變更"}
          </Button>
          <Link href={`/dashboard/brands/${brandSlug}`}>
            <Button type="button" variant="outline">
              取消
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
