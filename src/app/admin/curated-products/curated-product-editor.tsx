"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  createCuratedProductAction,
  prefillCuratedProductAction,
  retireCuratedProductSourceAction,
  updateCuratedProductAction,
} from "@/app/admin/curated-products/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  curatedProductPromoteBlockers,
  type PromoteBlocker,
} from "@/lib/curated-products/promote-gate";
import {
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import { CURATED_PRODUCT_SOURCE_TYPES } from "@/lib/validation/curated-product";

export type BrandOption = { id: string; slug: string; name: string };

type SourceDraft = { url: string; sourceType: string; claimZh: string };

const EMPTY_SOURCE: SourceDraft = {
  url: "",
  sourceType: "official",
  claimZh: "",
};

/** The four promote conditions, in the order the readout lists them. */
const GATE_CONDITIONS: PromoteBlocker[] = [
  "official_url",
  "source_checked_at",
  "no_active_source",
  "lifecycle",
];

/**
 * The promote gate, rendered as a pass/fail list FROM THE SHARED PREDICATE.
 *
 * `curatedProductPromoteBlockers` is the same function `promoteCuratedProduct`
 * runs before it writes, so a disabled "Promote to published" button always
 * explains itself on screen instead of arriving as a surprise error. Never
 * re-implement the four conditions here.
 *
 * `role="status"` and not `role="alert"`: this is a passive summary that is
 * present the whole time the drawer is open. An alert would interrupt a screen
 * reader on every keystroke that changes a field.
 */
export function PromoteGateReadout({
  product,
  sources,
}: {
  product: Pick<
    AdminCuratedProduct,
    "lifecycle" | "officialUrl" | "sourceCheckedAt"
  >;
  sources: readonly { state: string }[];
}): React.JSX.Element {
  const t = useTranslations("admin.curatedProducts.gate");
  const blockers = new Set(curatedProductPromoteBlockers(product, sources));

  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <p className="type-subsection-title">{t("title")}</p>
      <ul className="space-y-1">
        {GATE_CONDITIONS.map((condition) => {
          const failed = blockers.has(condition);
          return (
            <li key={condition} className="flex items-baseline gap-2">
              <span aria-hidden="true" className="type-metadata">
                {failed ? "×" : "✓"}
              </span>
              <span
                className={failed ? "type-error" : "type-body-muted"}
              >{`${t(`conditions.${condition}`)} — ${failed ? t("failed") : t("passed")}`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  // `<input type="date">` yields YYYY-MM-DD; the column is timestamptz, so the
  // date is anchored at UTC midnight rather than the browser's zone, which
  // would shift the stored day for anyone east of Greenwich.
  return `${value}T00:00:00Z`;
}

function fromIsoDate(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

/**
 * The curated-product ingest and edit form (DEV-1465).
 *
 * IMAGE CONSENT IS EXPLICIT: `imageUsage` stays at 'none' unless a human
 * selects otherwise. A freshly ingested product shows the fallback tile until
 * someone asserts the rights — a successful download is not permission.
 *
 * The image is downloaded, processed, and uploaded ON SAVE, never on paste:
 * `scripts/brand-storage-maintenance.ts` reclaims untracked objects against a
 * tight expected-untracked tolerance, so an abandoned form must leave no
 * storage object at all.
 */
export function CuratedProductEditor({
  mode,
  product,
  brands,
  defaultBrandId,
  onSaved,
}: {
  mode: "create" | "edit";
  product?: AdminCuratedProduct | null;
  brands: BrandOption[];
  defaultBrandId?: string | null;
  onSaved: () => void;
}): React.JSX.Element {
  const t = useTranslations("admin.curatedProducts.editor");
  const fieldId = useId();
  const [isPending, startTransition] = useTransition();
  const [isFetching, startFetchTransition] = useTransition();

  const [brandId, setBrandId] = useState(
    product?.brandId ?? defaultBrandId ?? brands[0]?.id ?? "",
  );
  const [prefillUrl, setPrefillUrl] = useState(product?.officialUrl ?? "");
  const [nameZh, setNameZh] = useState(product?.nameZh ?? "");
  const [nameEn, setNameEn] = useState(product?.nameEn ?? "");
  const [l1, setL1] = useState(product?.l1 ?? PRODUCT_TYPE_CATEGORIES[0].slug);
  const [l2, setL2] = useState<string[]>(product?.l2 ?? []);
  const [officialUrl, setOfficialUrl] = useState(product?.officialUrl ?? "");
  const [imageSourceUrl, setImageSourceUrl] = useState(
    product?.imageSourceUrl ?? "",
  );
  const [imageUsage, setImageUsage] = useState(product?.imageUsage ?? "none");
  const [notesZh, setNotesZh] = useState(product?.notesZh ?? "");
  const [notesEn, setNotesEn] = useState(product?.notesEn ?? "");
  const [reviewDueAt, setReviewDueAt] = useState(
    fromIsoDate(product?.reviewDueAt ?? null),
  );
  const [sourcesChecked, setSourcesChecked] = useState(
    Boolean(product?.sourceCheckedAt),
  );
  const [draftSources, setDraftSources] = useState<SourceDraft[]>([
    { ...EMPTY_SOURCE },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const subcategories = useMemo(
    () => PRODUCT_SUBCATEGORIES.filter((sub) => sub.category === l1),
    [l1],
  );

  const errorId = `${fieldId}-form-error`;
  const imageErrorId = `${fieldId}-image-error`;
  const imageHintId = `${fieldId}-image-hint`;

  function fetchDetails() {
    setFormError(null);
    startFetchTransition(async () => {
      const result = await prefillCuratedProductAction(prefillUrl);
      if ("error" in result) {
        setFormError(result.error);
        return;
      }
      // Suggestions only, and only into empty fields: a prefill must never
      // overwrite something an editor already typed.
      const { prefill } = result;
      if (prefill.nameZh && !nameZh) setNameZh(prefill.nameZh);
      if (prefill.nameEn && !nameEn) setNameEn(prefill.nameEn);
      if (prefill.description && !notesZh) setNotesZh(prefill.description);
      if (prefill.imageUrl && !imageSourceUrl)
        setImageSourceUrl(prefill.imageUrl);
      if (!officialUrl) setOfficialUrl(prefillUrl);
    });
  }

  function save() {
    setFormError(null);
    setImageError(null);

    const sources = draftSources
      .filter((source) => source.url.trim().length > 0)
      .map((source) => ({
        url: source.url.trim(),
        sourceType: source.sourceType,
        ...(source.claimZh.trim() ? { claimZh: source.claimZh.trim() } : {}),
      }));

    const payload = {
      nameZh: nameZh.trim(),
      ...(nameEn.trim() ? { nameEn: nameEn.trim() } : {}),
      l1,
      l2,
      ...(officialUrl.trim() ? { officialUrl: officialUrl.trim() } : {}),
      ...(imageSourceUrl.trim()
        ? { imageSourceUrl: imageSourceUrl.trim() }
        : {}),
      imageUsage,
      ...(notesZh.trim() ? { notesZh: notesZh.trim() } : {}),
      ...(notesEn.trim() ? { notesEn: notesEn.trim() } : {}),
      ...(toIsoDate(reviewDueAt)
        ? { reviewDueAt: toIsoDate(reviewDueAt) }
        : {}),
      sourcesChecked,
      ...(sources.length > 0 ? { sources } : {}),
    };

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createCuratedProductAction({ ...payload, brandId })
          : await updateCuratedProductAction(product?.id ?? "", payload, {
              brandId: product?.brandId,
              previousImageUrl: product?.imageUrl ?? null,
              published: product?.lifecycle === "published",
            });

      if (result?.error) {
        // `processImage` rejects GIF, SVG, and anything over 5 MB. That is a
        // fact about the URL the editor typed, so it is reported against the
        // image field rather than as a generic save failure.
        if (/image|format|size/i.test(result.error) && imageSourceUrl) {
          setImageError(result.error);
        } else {
          setFormError(result.error);
        }
        return;
      }

      setDraftSources([{ ...EMPTY_SOURCE }]);
      onSaved();
    });
  }

  function retireSource(sourceId: string) {
    if (!product) return;
    startTransition(async () => {
      const result = await retireCuratedProductSourceAction(
        sourceId,
        product.id,
      );
      if (result?.error) setFormError(result.error);
      else onSaved();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-prefill`}>{t("prefillLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`${fieldId}-prefill`}
            type="url"
            inputMode="url"
            className="max-w-lg"
            value={prefillUrl}
            onChange={(event) => setPrefillUrl(event.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            className="min-h-12"
            disabled={isFetching || prefillUrl.trim().length === 0}
            onClick={fetchDetails}
          >
            {isFetching ? t("fetching") : t("fetchDetails")}
          </Button>
        </div>
        <p className="type-form-hint">{t("prefillHint")}</p>
      </div>

      {mode === "create" ? (
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-brand`}>{t("brand")}</Label>
          <NativeSelect
            id={`${fieldId}-brand`}
            className="max-w-lg"
            value={brandId}
            onChange={(event) => setBrandId(event.target.value)}
          >
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-zh`}>{t("nameZh")}</Label>
          <Input
            id={`${fieldId}-name-zh`}
            value={nameZh}
            onChange={(event) => setNameZh(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-en`}>{t("nameEn")}</Label>
          <Input
            id={`${fieldId}-name-en`}
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-l1`}>{t("l1")}</Label>
        <NativeSelect
          id={`${fieldId}-l1`}
          className="max-w-lg"
          value={l1}
          onChange={(event) => {
            setL1(event.target.value);
            // L2 slugs only exist inside one L1, so a category change clears
            // them rather than carrying dead tags into the new branch.
            setL2([]);
          }}
        >
          {PRODUCT_TYPE_CATEGORIES.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <fieldset className="space-y-2">
        <legend className="type-form-label">{t("l2")}</legend>
        <div className="flex flex-wrap gap-2">
          {subcategories.map((sub) => (
            <ToggleChip
              key={sub.slug}
              pressed={l2.includes(sub.slug)}
              onPressedChange={(pressed) =>
                setL2((current) =>
                  pressed
                    ? [...current, sub.slug]
                    : current.filter((slug) => slug !== sub.slug),
                )
              }
            >
              {sub.nameEn}
            </ToggleChip>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-official-url`}>{t("officialUrl")}</Label>
        <Input
          id={`${fieldId}-official-url`}
          type="url"
          inputMode="url"
          className="max-w-lg"
          value={officialUrl}
          onChange={(event) => setOfficialUrl(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-image-url`}>{t("imageSourceUrl")}</Label>
        <Input
          id={`${fieldId}-image-url`}
          type="url"
          inputMode="url"
          className="max-w-lg"
          value={imageSourceUrl}
          onChange={(event) => setImageSourceUrl(event.target.value)}
          aria-invalid={imageError ? true : undefined}
          aria-describedby={imageError ? imageErrorId : imageHintId}
        />
        <p className="type-form-hint" id={imageHintId}>
          {t("imageHint")}
        </p>
        {imageError ? (
          <p className="type-error" id={imageErrorId}>
            {imageError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-image-usage`}>{t("imageUsage")}</Label>
        <NativeSelect
          id={`${fieldId}-image-usage`}
          className="max-w-lg"
          value={imageUsage}
          onChange={(event) => setImageUsage(event.target.value)}
          aria-describedby={`${fieldId}-image-usage-hint`}
        >
          <option value="none">{t("imageUsageNone")}</option>
          <option value="permitted">{t("imageUsagePermitted")}</option>
          <option value="licensed">{t("imageUsageLicensed")}</option>
        </NativeSelect>
        <p className="type-form-hint" id={`${fieldId}-image-usage-hint`}>
          {t("imageUsageHint")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-notes-zh`}>{t("notesZh")}</Label>
          <Textarea
            id={`${fieldId}-notes-zh`}
            value={notesZh}
            onChange={(event) => setNotesZh(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-notes-en`}>{t("notesEn")}</Label>
          <Textarea
            id={`${fieldId}-notes-en`}
            value={notesEn}
            onChange={(event) => setNotesEn(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-review-due`}>{t("reviewDueAt")}</Label>
        <Input
          id={`${fieldId}-review-due`}
          type="date"
          className="max-w-xs"
          value={reviewDueAt}
          onChange={(event) => setReviewDueAt(event.target.value)}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="type-subsection-title">{t("sources")}</legend>

        {product && product.sources.length > 0 ? (
          <ul className="space-y-2">
            {product.sources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center gap-3">
                <span className="type-body-muted break-all">{source.url}</span>
                <span className="type-metadata">
                  {t(`sourceState.${source.state}`)}
                </span>
                {source.state === "active" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-12"
                    disabled={isPending}
                    onClick={() => retireSource(source.id)}
                  >
                    {t("removeSource")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {draftSources.map((source, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-source-url-${index}`}>
                {t("sourceUrl")}
              </Label>
              <Input
                id={`${fieldId}-source-url-${index}`}
                type="url"
                inputMode="url"
                value={source.url}
                onChange={(event) =>
                  setDraftSources((current) =>
                    current.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, url: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-source-type-${index}`}>
                {t("sourceType")}
              </Label>
              <NativeSelect
                id={`${fieldId}-source-type-${index}`}
                value={source.sourceType}
                onChange={(event) =>
                  setDraftSources((current) =>
                    current.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, sourceType: event.target.value }
                        : entry,
                    ),
                  )
                }
              >
                {CURATED_PRODUCT_SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`sourceTypes.${type}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-source-claim-${index}`}>
                {t("sourceClaim")}
              </Label>
              <Input
                id={`${fieldId}-source-claim-${index}`}
                value={source.claimZh}
                onChange={(event) =>
                  setDraftSources((current) =>
                    current.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, claimZh: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="secondary"
          className="min-h-12"
          onClick={() =>
            setDraftSources((current) => [...current, { ...EMPTY_SOURCE }])
          }
        >
          {t("addSource")}
        </Button>

        <div className="flex items-center gap-2">
          <Checkbox
            id={`${fieldId}-sources-checked`}
            checked={sourcesChecked}
            onCheckedChange={(checked) => setSourcesChecked(checked)}
          />
          <Label htmlFor={`${fieldId}-sources-checked`}>
            {t("sourcesChecked")}
          </Label>
        </div>
      </fieldset>

      {formError ? (
        <p className="type-error" id={errorId} role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          className="min-h-12"
          disabled={isPending || nameZh.trim().length === 0 || !brandId}
          aria-describedby={formError ? errorId : undefined}
          onClick={save}
        >
          {isPending
            ? t("saving")
            : mode === "create"
              ? t("create")
              : t("save")}
        </Button>
      </div>
    </div>
  );
}
