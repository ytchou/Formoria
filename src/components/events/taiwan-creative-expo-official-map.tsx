"use client";

import { SurfaceImage } from "@/components/ui/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Maximize2, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { textStyles } from "@/components/ui/text-styles";
import { cn } from "@/lib/utils";
import {
  EXPO_FLOOR_MAP_ASSET,
  EXPO_FLOOR_MAP_GEOMETRY,
  EXPO_ROSTER_SOURCE_URL,
} from "./taiwan-creative-expo-floor-map-config";

type ZoomLevel = 1 | 2 | 4 | 8;

const ZOOM_LEVELS: readonly ZoomLevel[] = [1, 2, 4, 8];

/**
 * Shown in place of the plan when the raster will not load. Rendered in both
 * the inline frame and the viewer — a reader who hits the failure inline must
 * not have to open the viewer to discover the same failure and the PDF that
 * routes around it.
 */
function MapUnavailable() {
  const t = useTranslations("events");

  return (
    // OPAQUE `surface`, not `surface-deep/95`. Two reasons, both about the
    // text this panel carries: `--ink-muted` (which `cardDescription` resolves
    // to) measures 4.17:1 on `surface-deep`, under the 4.5:1 floor, and an
    // alpha scrim has no fixed contrast at all — it inherits whatever the
    // frame behind it happens to be. `surface` is 4.6:1 and is a number.
    <div className="absolute inset-0 grid place-items-center bg-surface p-6 text-center">
      <div className="max-w-md space-y-2">
        <p className={textStyles({ variant: "cardTitle" })}>
          {t("floorMapUnavailable")}
        </p>
        <p className={textStyles({ variant: "cardDescription" })}>
          {t("floorMapUnavailableHint")}
        </p>
        <a
          className={textStyles({ variant: "link" })}
          href={EXPO_FLOOR_MAP_ASSET.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t("floorMapOfficialPdf")}
          <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5" />
        </a>
      </div>
    </div>
  );
}

/**
 * The organizer's raster floor plan, rendered inline with a fullscreen viewer
 * beside it for reading booth numbers.
 *
 * Deliberately not a filter control. The interactive booth map that once sat
 * above the roster is retired; this one filters nothing — it is reference
 * material about the venue, so it sits with the rest of the venue facts at the
 * end of the event's "about" section, and it is the only place the 797KB raster
 * is ever requested.
 *
 * The inline render is lazy (no `priority`): it is well below the fold, and the
 * hero above it already holds the one eager image this page is allowed.
 *
 * The trade-off the move bought: the viewer no longer opens scrolled to the
 * zone the reader had selected downpage, because it no longer knows about that
 * selection. It always opens fit-to-width.
 */
export function TaiwanCreativeExpoOfficialMap() {
  const t = useTranslations("events");
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [imageFailed, setImageFailed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const rememberTriggerFocus = () => {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setZoom(1);
      return;
    }

    const previousFocus = previousFocusRef.current;
    if (previousFocus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => previousFocus.focus());
    }
  };

  // A reopened viewer must start at the top-left rather than wherever the
  // previous session was panned to: the scroll position survives in the DOM
  // node, the zoom level does not.
  useEffect(() => {
    if (!open) return;

    const frameId = window.requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open, zoom]);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className={textStyles({ variant: "sectionTitle" })}>
          {t("officialMapHeading")}
        </h2>
        <p className={textStyles({ variant: "sectionDescription" })}>
          {t("officialMapDescription")}
        </p>
      </div>

      {/*
        Both ways out of this section, side by side above the plan: enlarge it,
        or leave for the organizer's roster. As a text link the roster read as
        a footnote to the description rather than a peer of the viewer.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger
            onClick={rememberTriggerFocus}
            render={<Button size="compact" type="button" variant="secondary" />}
          >
            <Maximize2 aria-hidden="true" />
            {t("floorMapOpenViewer")}
          </DialogTrigger>
          <DialogContent
            className="h-[100dvh] w-screen max-w-none gap-0 rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-[min(96vw,1100px)] sm:rounded-[3px]"
            showCloseButton={false}
          >
            <DialogHeader className="flex-row items-start justify-between gap-3 border-b p-4 sm:p-5">
              <div className="min-w-0 space-y-1">
                <DialogTitle>{t("floorMapViewerTitle")}</DialogTitle>
                <DialogDescription>
                  {t("floorMapViewerDescription")}
                </DialogDescription>
              </div>
              <DialogClose
                render={
                  <Button
                    aria-label={t("floorMapCloseViewer")}
                    className="size-12"
                    size="icon"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <X aria-hidden="true" />
              </DialogClose>
            </DialogHeader>

            <div
              aria-label={t("floorMapLabel")}
              className="min-h-0 flex-1 overflow-auto overscroll-contain bg-surface-deep p-2 touch-pan-x touch-pan-y sm:p-4"
              ref={viewportRef}
              role="region"
              tabIndex={0}
            >
              <div
                className="relative min-w-full"
                style={{ width: `${zoom * 100}%` }}
              >
                <div
                  className="relative aspect-[3200/2450] w-full overflow-hidden bg-surface-deep"
                  data-map-image={EXPO_FLOOR_MAP_GEOMETRY.viewBox}
                >
                  <SurfaceImage
                    alt={EXPO_FLOOR_MAP_ASSET.alt}
                    className={cn("object-fill", imageFailed && "invisible")}
                    fill
                    onError={() => setImageFailed(true)}
                    surface="banner"
                    // The zoomed floor map is a printed 3200x2450 asset shown at
                    // 1200px on desktop, wider than any content surface.
                    sizes="(max-width: 640px) 100vw, 1200px"
                    src={EXPO_FLOOR_MAP_ASSET.src}
                  />
                  {imageFailed ? <MapUnavailable /> : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-ground p-3 sm:p-4">
              <span className={textStyles({ variant: "caption" })}>
                {t("floorMapZoom")}
              </span>
              <div className="flex flex-wrap gap-2">
                {ZOOM_LEVELS.map((level) => (
                  <Button
                    aria-label={
                      level === 1
                        ? t("floorMapFit")
                        : t("floorMapZoomTimes", { value: level })
                    }
                    aria-pressed={zoom === level}
                    className="min-w-12 px-2"
                    key={level}
                    onClick={() => setZoom(level)}
                    size="default"
                    type="button"
                    variant={zoom === level ? "primary" : "secondary"}
                  >
                    {level === 1 ? (
                      t("floorMapFit")
                    ) : (
                      <span aria-hidden="true">
                        {t("floorMapZoomTimes", { value: level })}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <a
          className={buttonVariants({ size: "compact", variant: "secondary" })}
          href={EXPO_ROSTER_SOURCE_URL}
          rel="noreferrer"
          target="_blank"
        >
          {t("explorerSource")}
          <ExternalLink aria-hidden="true" />
        </a>

        <a
          className={buttonVariants({ size: "compact", variant: "secondary" })}
          href={EXPO_FLOOR_MAP_ASSET.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t("floorMapOfficialPdf")}
          <ExternalLink aria-hidden="true" />
        </a>
      </div>

      {/*
        Rendered here rather than only inside the viewer: the plan is the
        answer to "where is this hall", and a reader should not have to open a
        dialog to get it. The viewer above stays, because at page width the
        booth numbers on a 3200px plan are not legible.
      */}
      <div
        className="relative mx-auto aspect-[3200/2450] w-full max-w-4xl overflow-hidden rounded-[3px] border border-rule bg-surface-deep"
        data-map-image={EXPO_FLOOR_MAP_GEOMETRY.viewBox}
      >
        <SurfaceImage
          alt={EXPO_FLOOR_MAP_ASSET.alt}
          className={cn("object-contain", imageFailed && "invisible")}
          fill
          onError={() => setImageFailed(true)}
          surface="banner"
          // The inline map frame caps at 896px.
          sizes="(max-width: 640px) 100vw, 896px"
          src={EXPO_FLOOR_MAP_ASSET.src}
        />
        {imageFailed ? <MapUnavailable /> : null}
      </div>

      {/*
        Attribution only. The PDF link moved up to the button row, where it sits
        with the other two ways out of this section instead of trailing the
        credit line as an afterthought.
      */}
      <p className={textStyles({ variant: "caption" })}>
        {t("floorMapAttribution")}
      </p>
    </div>
  );
}
