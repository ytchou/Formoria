"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  createCuratedProductAction,
  prefillCuratedProductAction,
  retireCuratedProductSelectionAction,
  retireCuratedProductSourceAction,
  upsertCuratedProductSelectionAction,
  updateCuratedProductAction,
} from "@/app/admin/curated-products/actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { inkActionClassName } from "@/components/admin/ink-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import { L2_SUBCATEGORIES, L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import type { TrailAuthoringWarning } from "@/lib/services/trail-authoring";
import {
  CURATED_PRODUCT_SOURCE_TYPES,
  MAX_NOTE,
  curatedProductUpdateSchema,
} from "@/lib/validation/curated-product";

export type BrandOption = { id: string; slug: string; name: string };

export type TrailOption = {
  slug: string;
  title: string;
  /**
   * The trail's MDX sections, followed by any `section_key` that still holds
   * active selections without being declared in the MDX. `orphaned` marks the
   * second group: those can only be RETIRED, because
   * `upsertCuratedProductSelection` validates the key against the frontmatter.
   */
  sections: { key: string; title: string; orphaned?: boolean }[];
  /**
   * Authoring notes for the editor, never a publish gate: the trail renders
   * and indexes the same whether this list is empty or not.
   */
  warnings: TrailAuthoringWarning[];
  placementReadError: boolean;
};

type SourceDraft = { url: string; sourceType: string; claimZh: string };

const EMPTY_SOURCE: SourceDraft = {
  url: "",
  sourceType: "official",
  claimZh: "",
};

/**
 * A URL the server's `httpUrlSchema` will accept: absolute, http(s) only.
 * Checked before posting because the Save button is not inside a `<form>`, so
 * `type="url"` never triggers browser constraint validation and a schemeless
 * `acme.com/widget` would come back as an unattributed "Invalid curated
 * product".
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
  trailOptions = [],
  onSaved,
}: {
  mode: "create" | "edit";
  product?: AdminCuratedProduct | null;
  brands: BrandOption[];
  defaultBrandId?: string | null;
  trailOptions?: TrailOption[];
  onSaved: () => void;
}): React.JSX.Element {
  const t = useTranslations("admin.curatedProducts.editor");
  const fieldId = useId();
  const [isPending, startTransition] = useTransition();
  const [isFetching, startFetchTransition] = useTransition();

  const [brandId, setBrandId] = useState(
    product?.brandId ?? defaultBrandId ?? brands.at(0)?.id ?? "",
  );
  const [prefillUrl, setPrefillUrl] = useState(product?.officialUrl ?? "");
  const [nameZh, setNameZh] = useState(product?.nameZh ?? "");
  const [nameEn, setNameEn] = useState(product?.nameEn ?? "");
  const [category, setCategory] = useState(
    product?.category ?? L1_CATEGORIES.at(0)?.slug ?? "",
  );
  const [subcategorySlugs, setSubcategorySlugs] = useState<string[]>(
    product?.subcategories ?? [],
  );
  const [officialUrl, setOfficialUrl] = useState(product?.officialUrl ?? "");
  const [imageSourceUrl, setImageSourceUrl] = useState(
    product?.imageSourceUrl ?? "",
  );
  const [productDescriptionZh, setProductDescriptionZh] = useState(
    product?.productDescriptionZh ?? "",
  );
  const [productDescriptionEn, setProductDescriptionEn] = useState(
    product?.productDescriptionEn ?? "",
  );
  const [productPosition, setProductPosition] = useState<number | null>(
    product?.productPosition ?? null,
  );
  const [reviewDueAt, setReviewDueAt] = useState(
    fromIsoDate(product?.reviewDueAt ?? null),
  );
  // A NEW product starts hidden: publication is a deliberate act, and the
  // create path stores `visible ?? false` for the same reason. This box is what
  // makes the act available at all — the promote gate it replaced left `visible`
  // with no writer, so nothing in the UI could publish (DEV-1485).
  const [visible, setVisible] = useState(product?.visible === true);
  const [sourcesChecked, setSourcesChecked] = useState(
    Boolean(product?.sourceCheckedAt),
  );
  const [draftSources, setDraftSources] = useState<SourceDraft[]>([
    { ...EMPTY_SOURCE },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [officialUrlError, setOfficialUrlError] = useState<string | null>(null);
  const [productPositionError, setProductPositionError] = useState<
    string | null
  >(null);
  const [productDescriptionZhError, setProductDescriptionZhError] = useState<
    string | null
  >(null);
  // Index → true for a draft source whose URL failed the client check.
  const [sourceUrlErrors, setSourceUrlErrors] = useState<
    Record<number, boolean>
  >({});
  const [uncheckSourcesOpen, setUncheckSourcesOpen] = useState(false);
  const [placementTrailSlug, setPlacementTrailSlug] = useState(
    trailOptions.at(0)?.slug ?? "",
  );
  const initialTrail = trailOptions.find(
    (trail) => trail.slug === placementTrailSlug,
  );
  const [placementSectionKey, setPlacementSectionKey] = useState(
    initialTrail?.sections.at(0)?.key ?? "",
  );
  const [placementPosition, setPlacementPosition] = useState(0);
  const [placementError, setPlacementError] = useState<string | null>(null);

  // The sources-checked box only needs the confirm step when clearing it would
  // pull a LIVE product off the brand page (DEV-1485).
  const isVisible = product?.visible === true;

  const subcategoryOptions = useMemo(
    () => L2_SUBCATEGORIES.filter((sub) => sub.category === category),
    [category],
  );

  const selectedTrail =
    trailOptions.find((trail) => trail.slug === placementTrailSlug) ?? null;
  const selectedSection =
    selectedTrail?.sections.find(
      (section) => section.key === placementSectionKey,
    ) ?? null;
  const sectionIsOrphaned = selectedSection?.orphaned === true;

  const existingPlacement =
    product?.selections.find(
      (selection) =>
        selection.trailSlug === placementTrailSlug &&
        selection.sectionKey === placementSectionKey,
    ) ?? null;

  /**
   * Read the STORED placement back into the form whenever the trail/section
   * pair changes, or whenever the stored row itself changes.
   *
   * The fingerprint includes the stored values, not just the key: a local
   * `useState` copy seeded once would go blind to the `router.refresh()` that
   * follows a save, so the panel would keep showing the pre-save numbers. The
   * "adjust state during render" pattern is used instead of an effect because
   * it repaints in the same commit, with no blank frame.
   */
  const placementSync = [
    placementTrailSlug,
    placementSectionKey,
    existingPlacement?.position ?? "",
  ].join(" ");
  // `null`, not `placementSync`: the first render must sync too, otherwise a
  // product that is already placed opens with the blank defaults.
  const [syncedPlacement, setSyncedPlacement] = useState<string | null>(null);
  if (syncedPlacement !== placementSync) {
    setSyncedPlacement(placementSync);
    setPlacementPosition(existingPlacement?.position ?? 0);
  }

  function changePlacementTrail(value: string) {
    setPlacementTrailSlug(value);
    setPlacementSectionKey(
      trailOptions.find((trail) => trail.slug === value)?.sections.at(0)?.key ??
        "",
    );
    setPlacementError(null);
  }

  function placeProduct() {
    setPlacementError(null);
    if (!product) {
      setPlacementError(t("placement.createFirst"));
      return;
    }
    if (!placementTrailSlug || !placementSectionKey) {
      setPlacementError(t("placement.required"));
      return;
    }
    startTransition(async () => {
      const result = await upsertCuratedProductSelectionAction({
        productId: product.id,
        trailSlug: placementTrailSlug,
        sectionKey: placementSectionKey,
        position: placementPosition,
      });
      if (result?.error) {
        setPlacementError(result.fieldErrors?.sectionKey ?? result.error);
      } else {
        // The fields are NOT cleared: they now read back the stored placement,
        // and the refresh below re-syncs them from the server row.
        onSaved();
      }
    });
  }

  function retirePlacement() {
    setPlacementError(null);
    if (!product || !placementTrailSlug || !placementSectionKey) {
      setPlacementError(t("placement.required"));
      return;
    }
    startTransition(async () => {
      const result = await retireCuratedProductSelectionAction({
        productId: product.id,
        trailSlug: placementTrailSlug,
        sectionKey: placementSectionKey,
      });
      if (result?.error) setPlacementError(result.error);
      else onSaved();
    });
  }

  const errorId = `${fieldId}-form-error`;
  const imageErrorId = `${fieldId}-image-error`;
  const imageHintId = `${fieldId}-image-hint`;
  const prefillErrorId = `${fieldId}-prefill-error`;
  const prefillHintId = `${fieldId}-prefill-hint`;
  const officialUrlErrorId = `${fieldId}-official-url-error`;
  const productPositionErrorId = `${fieldId}-product-position-error`;
  const productDescriptionZhErrorId = `${fieldId}-product-description-zh-error`;
  const placementErrorId = `${fieldId}-placement-error`;
  const sourceUrlErrorId = (index: number) =>
    `${fieldId}-source-url-error-${index}`;

  /** One row updater for the three draft-source inputs (was copy-pasted). */
  function updateSource(index: number, patch: Partial<SourceDraft>) {
    setDraftSources((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function fetchDetails() {
    setFormError(null);
    if (!isHttpUrl(prefillUrl.trim())) {
      setPrefillError(t("urlInvalid"));
      return;
    }
    setPrefillError(null);
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
      if (prefill.description && !productDescriptionZh)
        setProductDescriptionZh(prefill.description);
      if (prefill.imageUrl && !imageSourceUrl)
        setImageSourceUrl(prefill.imageUrl);
      if (!officialUrl) setOfficialUrl(prefillUrl);
    });
  }

  function save() {
    setFormError(null);
    setImageError(null);
    setProductPositionError(null);
    setProductDescriptionZhError(null);

    // URL fields are checked HERE, per field. The server's blanket
    // `{ error: "Invalid curated product" }` cannot say which input is wrong,
    // so a schemeless URL would come back unattributed and re-saving would
    // reproduce it exactly.
    const trimmedOfficialUrl = officialUrl.trim();
    const trimmedImageSourceUrl = imageSourceUrl.trim();
    const officialInvalid =
      trimmedOfficialUrl.length > 0 && !isHttpUrl(trimmedOfficialUrl);
    const imageInvalid =
      trimmedImageSourceUrl.length > 0 && !isHttpUrl(trimmedImageSourceUrl);
    const invalidSources: Record<number, boolean> = {};
    draftSources.forEach((source, index) => {
      const url = source.url.trim();
      if (url.length > 0 && !isHttpUrl(url)) invalidSources[index] = true;
    });

    setOfficialUrlError(officialInvalid ? t("urlInvalid") : null);
    setImageError(imageInvalid ? t("urlInvalid") : null);
    setSourceUrlErrors(invalidSources);

    if (officialInvalid || imageInvalid || Object.keys(invalidSources).length) {
      setFormError(t("urlFieldsBlockSave"));
      return;
    }

    const sources = draftSources
      .filter((source) => source.url.trim().length > 0)
      .map((source) => ({
        url: source.url.trim(),
        sourceType: source.sourceType,
        ...(source.claimZh.trim() ? { claimZh: source.claimZh.trim() } : {}),
      }));

    // An EMPTIED optional field posts an explicit `null` ("clear this value"),
    // never an omission. Under the partial update schema an absent key means
    // "leave unchanged", so omitting emptied fields made a dead Official URL
    // impossible to clear: the save reported success and the public brand page
    // kept rendering the old CTA. Only fields the form does not render at all
    // stay omitted.
    // The description is the one editorial field the column will not accept as
    // empty, so it is checked here rather than posted and bounced back as the
    // action's unattributed "Invalid curated product".
    const trimmedDescriptionZh = productDescriptionZh.trim();
    const editorial = {
      nameEn: nameEn.trim() || null,
      officialUrl: trimmedOfficialUrl || null,
      imageSourceUrl: trimmedImageSourceUrl || null,
      productDescriptionEn: productDescriptionEn.trim() || null,
      productPosition,
      reviewDueAt: toIsoDate(reviewDueAt) ?? null,
      visible,
    };

    const positionValidation = curatedProductUpdateSchema.safeParse({
      productDescriptionZh: trimmedDescriptionZh,
      productPosition: editorial.productPosition,
    });
    if (!positionValidation.success) {
      const { fieldErrors } = positionValidation.error.flatten();
      // The MESSAGE is chosen from the issue code, not from the field name: a
      // description over `MAX_NOTE` used to be reported as "write one", which
      // reads as a lie against a visibly full textarea and never names the real
      // constraint. `too_big` is the only other way this field can fail.
      const descriptionIssue = positionValidation.error.issues.find(
        (issue) => issue.path[0] === "productDescriptionZh",
      );
      const positionIssue = fieldErrors.productPosition?.at(0);
      setProductDescriptionZhError(
        descriptionIssue
          ? descriptionIssue.code === "too_big"
            ? t("productDescriptionZhTooLong", { max: MAX_NOTE })
            : t("productDescriptionZhRequired")
          : null,
      );
      setProductPositionError(
        positionIssue ? t("productPositionInvalid") : null,
      );
      // Unconditional: `safeParse` receives exactly the two fields read above,
      // and the schema's only non-field issue is a `subcategories`/`category`
      // refine on a key
      // that is not passed here. A failure is always one of these two.
      return;
    }

    const payload = {
      nameZh: nameZh.trim(),
      category,
      subcategories: subcategorySlugs,
      sourcesChecked,
      productDescriptionZh: trimmedDescriptionZh,
      ...(sources.length > 0 ? { sources } : {}),
    };

    startTransition(async () => {
      const result =
        mode === "create"
          ? // Create has nothing to clear, so an empty field stays absent.
            await createCuratedProductAction({
              ...payload,
              ...(editorial.nameEn ? { nameEn: editorial.nameEn } : {}),
              ...(editorial.officialUrl
                ? { officialUrl: editorial.officialUrl }
                : {}),
              ...(editorial.imageSourceUrl
                ? { imageSourceUrl: editorial.imageSourceUrl }
                : {}),
              ...(editorial.productDescriptionEn
                ? { productDescriptionEn: editorial.productDescriptionEn }
                : {}),
              ...(editorial.productPosition !== null
                ? { productPosition: editorial.productPosition }
                : {}),
              ...(editorial.reviewDueAt
                ? { reviewDueAt: editorial.reviewDueAt }
                : {}),
              // Sent explicitly rather than left to the column default: the
              // default publishes, and a create must not.
              visible: editorial.visible,
              brandId,
            })
          : await updateCuratedProductAction(product?.id ?? "", {
              ...payload,
              ...editorial,
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

  function handleSourcesCheckedChange(checked: boolean) {
    if (!checked && sourcesChecked && isVisible) {
      setUncheckSourcesOpen(true);
      return;
    }
    setSourcesChecked(checked);
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
            onChange={(event) => {
              setPrefillUrl(event.target.value);
              setPrefillError(null);
            }}
            aria-invalid={prefillError ? true : undefined}
            aria-describedby={prefillError ? prefillErrorId : prefillHintId}
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
        <p className="type-metadata" id={prefillHintId}>
          {t("prefillHint")}
        </p>
        {prefillError ? (
          <p className="type-metadata text-danger" id={prefillErrorId}>
            {prefillError}
          </p>
        ) : null}
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
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            // A subcategory slug only exists inside one category, so a category
            // change clears them rather than carrying dead tags into the new
            // branch.
            setSubcategorySlugs([]);
          }}
        >
          {L1_CATEGORIES.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <fieldset className="space-y-2">
        <legend className="type-body-sm font-semibold text-ink">{t("l2")}</legend>
        <ChipRow>
          {subcategoryOptions.map((sub) => (
            <ToggleChip
              key={sub.slug}
              pressed={subcategorySlugs.includes(sub.slug)}
              onPressedChange={(pressed) =>
                setSubcategorySlugs((current) =>
                  pressed
                    ? [...current, sub.slug]
                    : current.filter((slug) => slug !== sub.slug),
                )
              }
            >
              {sub.nameEn}
            </ToggleChip>
          ))}
        </ChipRow>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-official-url`}>{t("officialUrl")}</Label>
        <Input
          id={`${fieldId}-official-url`}
          type="url"
          inputMode="url"
          className="max-w-lg"
          value={officialUrl}
          onChange={(event) => {
            setOfficialUrl(event.target.value);
            setOfficialUrlError(null);
          }}
          aria-invalid={officialUrlError ? true : undefined}
          aria-describedby={officialUrlError ? officialUrlErrorId : undefined}
        />
        {officialUrlError ? (
          <p className="type-metadata text-danger" id={officialUrlErrorId}>
            {officialUrlError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-image-url`}>{t("imageSourceUrl")}</Label>
        <Input
          id={`${fieldId}-image-url`}
          type="url"
          inputMode="url"
          className="max-w-lg"
          value={imageSourceUrl}
          onChange={(event) => {
            setImageSourceUrl(event.target.value);
            setImageError(null);
          }}
          aria-invalid={imageError ? true : undefined}
          // Same shape, same fix as the description below: the hint keeps being
          // announced when the field is invalid.
          aria-describedby={
            imageError ? `${imageErrorId} ${imageHintId}` : imageHintId
          }
        />
        <p className="type-metadata" id={imageHintId}>
          {t("imageHint")}
        </p>
        {imageError ? (
          <p className="type-metadata text-danger" id={imageErrorId}>
            {imageError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-product-description-zh`}>
            {t("productDescriptionZh")}
          </Label>
          <Textarea
            id={`${fieldId}-product-description-zh`}
            value={productDescriptionZh}
            required
            onChange={(event) => {
              setProductDescriptionZh(event.target.value);
              setProductDescriptionZhError(null);
            }}
            aria-invalid={productDescriptionZhError ? true : undefined}
            // BOTH ids when invalid, error first. Swapping the hint out for the
            // error withdrew the field's only statement of the content rules at
            // the exact moment the editor needs them; a sighted editor keeps
            // seeing both, so the swap only ever cost screen-reader users.
            aria-describedby={
              productDescriptionZhError
                ? `${productDescriptionZhErrorId} ${fieldId}-product-description-hint`
                : `${fieldId}-product-description-hint`
            }
          />
          <p
            className="type-metadata"
            id={`${fieldId}-product-description-hint`}
          >
            {t("productDescriptionHint")}
          </p>
          {productDescriptionZhError ? (
            <p className="type-metadata text-danger" id={productDescriptionZhErrorId}>
              {productDescriptionZhError}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-product-description-en`}>
            {t("productDescriptionEn")}
          </Label>
          <Textarea
            id={`${fieldId}-product-description-en`}
            value={productDescriptionEn}
            onChange={(event) => setProductDescriptionEn(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-product-position`}>
            {t("productPosition")}
          </Label>
          <Input
            id={`${fieldId}-product-position`}
            type="number"
            min={0}
            step={1}
            value={productPosition ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "") {
                setProductPosition(null);
              } else {
                const parsed = Number(value);
                setProductPosition(Number.isFinite(parsed) ? parsed : null);
              }
              setProductPositionError(null);
            }}
            aria-invalid={productPositionError ? true : undefined}
            aria-describedby={
              productPositionError ? productPositionErrorId : undefined
            }
          />
          {productPositionError ? (
            <p className="type-metadata text-danger" id={productPositionErrorId}>
              {productPositionError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${fieldId}-visible`}
            checked={visible}
            onCheckedChange={setVisible}
            aria-describedby={`${fieldId}-visible-hint`}
          />
          <Label htmlFor={`${fieldId}-visible`}>{t("visible")}</Label>
        </div>
        <p className="type-metadata" id={`${fieldId}-visible-hint`}>
          {t("visibleHint")}
        </p>
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
        <legend className="type-body-sm font-semibold text-ink">{t("sources")}</legend>

        {product && product.sources.length > 0 ? (
          <ul className="space-y-2">
            {product.sources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center gap-3">
                <span className="type-body-sm break-all">{source.url}</span>
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
                onChange={(event) => {
                  updateSource(index, { url: event.target.value });
                  setSourceUrlErrors((current) => {
                    if (!current[index]) return current;
                    const next = { ...current };
                    delete next[index];
                    return next;
                  });
                }}
                aria-invalid={sourceUrlErrors[index] ? true : undefined}
                aria-describedby={
                  sourceUrlErrors[index] ? sourceUrlErrorId(index) : undefined
                }
              />
              {sourceUrlErrors[index] ? (
                <p className="type-metadata text-danger" id={sourceUrlErrorId(index)}>
                  {t("urlInvalid")}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-source-type-${index}`}>
                {t("sourceType")}
              </Label>
              <NativeSelect
                id={`${fieldId}-source-type-${index}`}
                value={source.sourceType}
                onChange={(event) =>
                  updateSource(index, { sourceType: event.target.value })
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
                  updateSource(index, { claimZh: event.target.value })
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
            onCheckedChange={handleSourcesCheckedChange}
            aria-describedby={
              isVisible ? `${fieldId}-sources-checked-hint` : undefined
            }
          />
          <Label htmlFor={`${fieldId}-sources-checked`}>
            {t("sourcesChecked")}
          </Label>
        </div>
        {isVisible ? (
          <p className="type-metadata" id={`${fieldId}-sources-checked-hint`}>
            {t("sourcesCheckedPublishedHint")}
          </p>
        ) : null}
      </fieldset>

      {trailOptions.length > 0 ? (
        <fieldset className="space-y-3 rounded-[3px] border border-rule p-4">
          <legend className="type-body-sm font-semibold text-ink">
            {t("placement.title")}
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-trail`}>{t("placement.trail")}</Label>
              <NativeSelect
                id={`${fieldId}-trail`}
                value={placementTrailSlug}
                onChange={(event) => changePlacementTrail(event.target.value)}
              >
                {trailOptions.map((trail) => (
                  <option key={trail.slug} value={trail.slug}>
                    {trail.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-section`}>
                {t("placement.section")}
              </Label>
              <NativeSelect
                id={`${fieldId}-section`}
                value={placementSectionKey}
                onChange={(event) => setPlacementSectionKey(event.target.value)}
                aria-invalid={placementError ? true : undefined}
                aria-describedby={placementError ? placementErrorId : undefined}
              >
                {(selectedTrail?.sections ?? []).map((section) => (
                  <option key={section.key} value={section.key}>
                    {section.orphaned
                      ? `${section.title} — ${t("placement.orphanSuffix")}`
                      : section.title}
                  </option>
                ))}
              </NativeSelect>
              {sectionIsOrphaned ? (
                <p role="status" className="type-metadata">
                  {t("placement.orphanHint")}
                </p>
              ) : null}
            </div>
          </div>
          {selectedTrail?.placementReadError ? (
            <p role="status" className="type-metadata">
              {t("placement.readError")}
            </p>
          ) : null}
          {/* Independent of the read error above, not an else-branch of it: a
              failed placement read still leaves the frontmatter-derived
              warnings (draft) worth showing. */}
          {selectedTrail?.warnings.length ? (
            <div
              role="status"
              className="space-y-2 rounded-[4px] bg-surface p-3"
            >
              <p className="type-body-sm font-semibold text-ink">{t("placement.blockersTitle")}</p>
              <ul className="list-disc pl-5 type-metadata">
                {selectedTrail.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-placement-position`}>
              {t("placement.position")}
            </Label>
            <Input
              id={`${fieldId}-placement-position`}
              className="max-w-[8rem]"
              type="number"
              min={0}
              step={1}
              value={placementPosition}
              onChange={(event) =>
                setPlacementPosition(Number(event.target.value) || 0)
              }
            />
          </div>
          {placementError ? (
            <p className="type-metadata text-danger" id={placementErrorId} role="alert">
              {placementError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-12"
              disabled={isPending || sectionIsOrphaned}
              onClick={placeProduct}
            >
              {t("placement.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              disabled={isPending}
              onClick={retirePlacement}
            >
              {t("placement.retire")}
            </Button>
          </div>
        </fieldset>
      ) : null}

      {/*
        Unchecking on a VISIBLE product clears `source_checked_at`, and
        `getPublishedCuratedProductsForBrand` filters on that column — the
        product leaves the brand page the moment this save revalidates, while
        the queue still lists it under Visible. Confirming is the reversible
        option: re-checking and saving puts it back, whereas blocking the
        control would force a retire round trip to correct a mistake.
      */}
      <ConfirmDialog
        open={uncheckSourcesOpen}
        onOpenChange={(open) => {
          if (!open) setUncheckSourcesOpen(false);
        }}
        title={t("uncheckSourcesTitle")}
        description={t("uncheckSourcesDescription")}
        confirmLabel={t("uncheckSourcesConfirm")}
        variant="destructive"
        onConfirm={() => {
          setSourcesChecked(false);
          setUncheckSourcesOpen(false);
        }}
      />

      {formError ? (
        <p className="type-metadata text-danger" id={errorId} role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          className={inkActionClassName}
          disabled={
            isPending ||
            nameZh.trim().length === 0 ||
            productDescriptionZh.trim().length === 0 ||
            !brandId
          }
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
