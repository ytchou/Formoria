"use client";

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import { useActionState, useId, useState } from "react";
import {
  submitChannelInfoAction,
  type ChannelFormState,
} from "@/app/[locale]/brands/[slug]/actions";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Typography } from "@/components/ui/typography";
import { usePathname } from "@/i18n/navigation";
import { signInHref } from "@/i18n/locale-preference";
import { useUser } from "@/lib/auth/use-user";

const REGION_KEYS = [
  "taipei",
  "new_taipei",
  "taoyuan",
  "taichung",
  "tainan",
  "kaohsiung",
  "keelung",
  "hsinchu_city",
  "chiayi_city",
  "hsinchu_county",
  "miaoli",
  "changhua",
  "nantou",
  "yunlin",
  "chiayi_county",
  "pingtung",
  "yilan",
  "hualien",
  "taitung",
  "penghu",
  "kinmen",
  "lienchiang",
] as const;

export type ProvideChannelInfoDialogProps = {
  brandId: string;
  brandSlug: string;
};

export function ProvideChannelInfoDialog({
  brandId,
  brandSlug,
}: ProvideChannelInfoDialogProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("brandDetail");
  const tCities = useTranslations("cities");
  const tNav = useTranslations("nav");
  const { user, loading } = useUser();
  const [state, action, pending] = useActionState<ChannelFormState, FormData>(
    submitChannelInfoAction,
    {},
  );
  const [channelType, setChannelType] = useState<"online" | "offline">(
    "offline",
  );
  const fieldId = useId().replaceAll(":", "");
  const requiresSignIn = !loading && !user;

  return (
    <Dialog>
      <DialogTrigger
        className={buttonVariants({
          variant: "secondary",
          className: "min-h-12 shrink-0",
        })}
      >
        {t("channels.provideInfo")}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="flex-row gap-3 p-4 sm:p-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <TriangleAlert aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <DialogTitle>{t("channels.dialog.title")}</DialogTitle>
            <DialogDescription>{t("channels.subtitle")}</DialogDescription>
          </div>
        </DialogHeader>

        {state.success ? (
          <div className="space-y-5 p-4 sm:p-6">
            <div className="flex items-center gap-3 rounded-lg border border-verified-green/30 bg-verified-green-bg p-4 text-verified-green">
              <Check aria-hidden="true" className="size-5 shrink-0" />
              <Typography variant="cardDescription">
                {t("channels.dialog.success")}
              </Typography>
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-b-xl bg-background p-0">
              <DialogClose render={<Button variant="secondary" />}>
                {t("report.close")}
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="flex flex-col">
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="brandSlug" value={brandSlug} />

            <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-name`}>
                  {t("channels.dialog.nameLabel")}
                </Label>
                <Input
                  id={`${fieldId}-name`}
                  name="name"
                  placeholder={t("channels.dialog.namePlaceholder")}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-type`}>
                  {t("channels.dialog.channelTypeLabel")}
                </Label>
                <NativeSelect
                  id={`${fieldId}-type`}
                  name="channelType"
                  value={channelType}
                  onChange={(event) =>
                    setChannelType(
                      event.currentTarget.value as "online" | "offline",
                    )
                  }
                >
                  <option value="online">
                    {t("channels.dialog.channelTypeOnline")}
                  </option>
                  <option value="offline">
                    {t("channels.dialog.channelTypeOffline")}
                  </option>
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-category`}>
                  {t("channels.dialog.categoryLabel")}
                </Label>
                <NativeSelect
                  id={`${fieldId}-category`}
                  name="category"
                  defaultValue=""
                >
                  <option value="">
                    {t("channels.dialog.categoryPlaceholder")}
                  </option>
                  <option value="brand_store">
                    {t("channels.dialog.categoryBrandStore")}
                  </option>
                  <option value="department_counter">
                    {t("channels.dialog.categoryDepartment")}
                  </option>
                  <option value="stockist">
                    {t("channels.dialog.categoryStockist")}
                  </option>
                  <option value="other">
                    {t("channels.dialog.categoryOther")}
                  </option>
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-region`}>
                  {t("channels.dialog.regionLabel")}
                </Label>
                <NativeSelect
                  id={`${fieldId}-region`}
                  name="region"
                  defaultValue=""
                >
                  <option value="">
                    {t("channels.dialog.regionPlaceholder")}
                  </option>
                  {REGION_KEYS.map((regionKey) => (
                    <option key={regionKey} value={regionKey}>
                      {tCities(regionKey)}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {channelType === "offline" ? (
                <div className="space-y-2">
                  <Label htmlFor={`${fieldId}-address`}>
                    {t("channels.dialog.addressLabel")}
                  </Label>
                  <Input
                    id={`${fieldId}-address`}
                    name="address"
                    placeholder={t("channels.dialog.addressPlaceholder")}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-url`}>
                  {t("channels.dialog.urlLabel")}
                </Label>
                <Input
                  id={`${fieldId}-url`}
                  name="url"
                  type="url"
                  placeholder={t("channels.dialog.urlPlaceholder")}
                />
              </div>

              {state.error ? (
                <Typography variant="error" role="alert">
                  {state.error}
                </Typography>
              ) : null}
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-b-xl px-4 py-4 sm:px-6">
              <DialogClose
                render={<Button variant="secondary" type="button" />}
              >
                {t("report.cancel")}
              </DialogClose>
              {requiresSignIn ? (
                <div className="flex flex-col gap-2 sm:contents">
                  <Typography
                    variant="cardDescription"
                    className="sm:order-first sm:mr-auto"
                  >
                    {t("channels.dialog.signInRequired")}
                  </Typography>
                  <NextLink
                    href={signInHref(pathname, locale)}
                    className={buttonVariants({ variant: "primary" })}
                  >
                    {tNav("signIn")}
                  </NextLink>
                </div>
              ) : (
                <Button type="submit" disabled={pending || loading}>
                  {t("channels.dialog.submit")}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
