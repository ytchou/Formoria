"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";

type ProductSortSelectProps = {
  currentSort: string;
};

export function ProductSortSelect({ currentSort }: ProductSortSelectProps) {
  const t = useTranslations("products.filters");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "newest") {
      params.delete("sort");
    } else {
      params.set("sort", value);
    }
    params.delete("page");
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  return (
    <Label className="flex items-center gap-2 type-body-sm">
      <span className="text-ink-muted shrink-0">{t("sortLabel")}</span>
      <NativeSelect
        value={currentSort}
        onChange={handleChange}
        disabled={isPending}
        className="min-h-12 w-auto"
      >
        <option value="newest">{t("sortNewest")}</option>
        <option value="alphabetical">{t("sortAlphabetical")}</option>
      </NativeSelect>
    </Label>
  );
}
