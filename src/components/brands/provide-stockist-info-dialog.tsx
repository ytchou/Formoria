"use client";

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, Pencil, TriangleAlert } from "lucide-react";
import { useActionState, useId, useState } from "react";
import {
  submitStockistInfoAction,
  type StockistFormState,
} from "@/app/[locale]/(site)/brands/[slug]/actions";
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

export type ProvideStockistInfoDialogProps = {
  brandId: string;
  brandSlug: string;
};

export function ProvideStockistInfoDialog({
  brandId,
  brandSlug,
}: ProvideStockistInfoDialogProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("brandDetail");
  const tCities = useTranslations("cities");
  const tNav = useTranslations("nav");
  const { user, loading } = useUser();
  const [state, action, pending] = useActionState<StockistFormState, FormData>(
    submitStockistInfoAction,
    {},
  );
  const fieldId = useId().replaceAll(":", "");
  const requiresSignIn = !loading && !user;
  // The select offers Taiwan regions only, so a blank one is not "somewhere
  // else" — it is a missing fact. Left optional, it stored `region_label: null`
  // and the brand page grouped the approved row under the Overseas heading
  // while `/where-to-buy` dropped it entirely. `required` is the enforcement
  // here; the service rejects `invalid_region` for callers that skip it. This
  // state is what makes the failure readable after the native bubble goes.
  const [regionMissing, setRegionMissing] = useState(false);
  const regionErrorId = `${fieldId}-region-error`;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="relative gap-1.5 px-1 type-metadata text-accent underline-offset-4 after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] hover:bg-transparent hover:text-accent/80 hover:underline focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
        }
      >
        <Pencil aria-hidden="true" />
        {t("channels.provideInfo")}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="flex-row gap-3 p-4 sm:p-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <TriangleAlert aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <DialogTitle>{t("channels.dialog.title")}</DialogTitle>
            <DialogDescription>{t("channels.subtitle")}</DialogDescription>
          </div>
        </DialogHeader>

        {state.success ? (
          <div className="space-y-5 p-4 sm:p-6">
            <div className="flex items-center gap-3 rounded-surface border border-verified-green/30 bg-verified-green-bg p-4 text-verified-green">
              <Check aria-hidden="true" className="size-5 shrink-0" />
              <Typography variant="cardDescription">
                {t("channels.dialog.success")}
              </Typography>
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-b-surface bg-ground p-0">
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
                  <span aria-hidden="true" className="text-danger">
                    {" "}
                    *
                  </span>
                </Label>
                <Input
                  id={`${fieldId}-name`}
                  name="name"
                  placeholder={t("channels.dialog.namePlaceholder")}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-region`}>
                  {t("channels.dialog.regionLabel")}
                  <span aria-hidden="true" className="text-danger">
                    {" "}
                    *
                  </span>
                </Label>
                <NativeSelect
                  id={`${fieldId}-region`}
                  name="region"
                  defaultValue=""
                  required
                  aria-invalid={regionMissing || undefined}
                  // Only while the message exists: an `aria-describedby`
                  // pointing at an id that never renders announces a region
                  // that is not there.
                  aria-describedby={regionMissing ? regionErrorId : undefined}
                  onInvalid={() => setRegionMissing(true)}
                  onChange={(event) => {
                    if (event.currentTarget.value) setRegionMissing(false);
                  }}
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
                {/* The native bubble says "please select an item"; this says
                    which fact is missing and stays on screen until it is
                    supplied. */}
                {regionMissing ? (
                  <Typography id={regionErrorId} variant="error" role="alert">
                    {t("channels.dialog.regionRequired")}
                  </Typography>
                ) : null}
              </div>

              {/* Always rendered. It used to be gated on an offline selection;
                  every stockist is a physical place now (DEV-1513), so the
                  address is the field that identifies it. */}
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

            <DialogFooter className="mx-0 mb-0 rounded-b-surface px-4 py-4 sm:px-6">
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
