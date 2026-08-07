"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, Maximize2, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { textStyles } from "@/components/ui/text-styles";
import { cn } from "@/lib/utils";
import {
  EXPO_FLOOR_MAP_ASSET,
  EXPO_FLOOR_MAP_GEOMETRY,
  EXPO_ZONE_DEFINITIONS,
  resolveExpoZoneVisualState,
  type ExpoZoneCode,
  type ExpoZoneDefinition,
  type ExpoZoneVisualState,
} from "./taiwan-creative-expo-floor-map-config";

export type TaiwanCreativeExpoFloorMapProps = {
  selectedZone: ExpoZoneCode | null;
  highlightedZones?: readonly ExpoZoneCode[];
  zoneCounts: Readonly<Record<ExpoZoneCode, number>>;
  onZoneSelect: (zone: ExpoZoneCode) => void;
  onReset: () => void;
};

type ZoomLevel = 1 | 2 | 4 | 8;

const ZOOM_LEVELS: readonly ZoomLevel[] = [1, 2, 4, 8];

type FloorMapCopy = {
  heading: string;
  description: string;
  mapLabel: string;
  zoneControls: string;
  selected: string;
  highlighted: string;
  secondary: string;
  reset: string;
  openViewer: string;
  viewerTitle: string;
  viewerDescription: string;
  closeViewer: string;
  zoom: string;
  fit: string;
  zoomTimes: (value: ZoomLevel) => string;
  mapUnavailable: string;
  mapUnavailableHint: string;
  noScript: string;
  officialPdf: string;
  attribution: string;
  officialSite: string;
  allZones: string;
  nonInteractive: string;
};

function stateOpacity(state: ExpoZoneVisualState): number {
  if (state === "selected") return 0.36;
  if (state === "highlighted") return 0.26;
  if (state === "secondary") return 0.08;
  return 0.15;
}

function stateStrokeWidth(state: ExpoZoneVisualState): number {
  if (state === "selected") return 18;
  if (state === "highlighted") return 12;
  return 8;
}

function pointsToString(definition: ExpoZoneDefinition): string {
  return definition.polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

function ZoneOverlay({
  selectedZone,
  highlightedZones,
  onZoneSelect,
  onReset,
  copy,
  zoneName,
}: Pick<
  TaiwanCreativeExpoFloorMapProps,
  "selectedZone" | "highlightedZones" | "onZoneSelect" | "onReset"
> & { copy: FloorMapCopy; zoneName: (zone: ExpoZoneDefinition) => string }) {
  const titleId = useId();

  const activateZone = (zone: ExpoZoneCode) => {
    if (zone === selectedZone) {
      onReset();
      return;
    }
    onZoneSelect(zone);
  };

  return (
    <svg
      aria-labelledby={titleId}
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      role="group"
      viewBox={EXPO_FLOOR_MAP_GEOMETRY.viewBox}
    >
      <title id={titleId}>{copy.mapLabel}</title>
      {EXPO_ZONE_DEFINITIONS.map((definition) => {
        const state = resolveExpoZoneVisualState({
          zone: definition.code,
          selectedZone,
          highlightedZones,
        });
        const label = `${definition.code}: ${zoneName(definition)}`;

        return (
          <polygon
            aria-label={label}
            aria-pressed={state === "selected"}
            className="pointer-events-auto cursor-pointer outline-none focus-visible:stroke-foreground focus-visible:stroke-[24px]"
            fill={definition.color}
            fillOpacity={stateOpacity(state)}
            key={definition.code}
            onClick={() => activateZone(definition.code)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateZone(definition.code);
              }
            }}
            points={pointsToString(definition)}
            role="button"
            stroke={definition.color}
            strokeDasharray={state === "highlighted" ? "34 22" : undefined}
            strokeOpacity={state === "secondary" ? 0.4 : 0.92}
            strokeWidth={stateStrokeWidth(state)}
            tabIndex={0}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

function MapImage({
  imageFailed,
  onImageError,
  selectedZone,
  highlightedZones,
  onZoneSelect,
  onReset,
  copy,
  zoneName,
}: {
  imageFailed: boolean;
  onImageError: () => void;
  selectedZone: ExpoZoneCode | null;
  highlightedZones?: readonly ExpoZoneCode[];
  onZoneSelect: (zone: ExpoZoneCode) => void;
  onReset: () => void;
  copy: FloorMapCopy;
  zoneName: (zone: ExpoZoneDefinition) => string;
}) {
  return (
    <div
      className="relative aspect-[3200/2450] w-full overflow-hidden bg-muted"
      data-map-image={EXPO_FLOOR_MAP_GEOMETRY.viewBox}
    >
      <Image
        alt={EXPO_FLOOR_MAP_ASSET.alt}
        className={cn("object-fill", imageFailed && "invisible")}
        fill
        onError={onImageError}
        sizes="(max-width: 640px) 100vw, 1100px"
        src={EXPO_FLOOR_MAP_ASSET.src}
      />
      {!imageFailed ? (
        <ZoneOverlay
          copy={copy}
          highlightedZones={highlightedZones}
          onReset={onReset}
          onZoneSelect={onZoneSelect}
          selectedZone={selectedZone}
          zoneName={zoneName}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-muted/95 p-6 text-center">
          <div className="max-w-md space-y-2">
            <p className={textStyles({ variant: "cardTitle" })}>
              {copy.mapUnavailable}
            </p>
            <p className={textStyles({ variant: "cardDescription" })}>
              {copy.mapUnavailableHint}
            </p>
            <a
              className={textStyles({ variant: "link" })}
              href={EXPO_FLOOR_MAP_ASSET.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {copy.officialPdf}
              <ExternalLink
                aria-hidden="true"
                className="ml-1 inline size-3.5"
              />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneControls({
  selectedZone,
  highlightedZones,
  zoneCounts,
  onZoneSelect,
  onReset,
  copy,
  zoneName,
}: Pick<
  TaiwanCreativeExpoFloorMapProps,
  | "selectedZone"
  | "highlightedZones"
  | "zoneCounts"
  | "onZoneSelect"
  | "onReset"
> & { copy: FloorMapCopy; zoneName: (zone: ExpoZoneDefinition) => string }) {
  const activateZone = (zone: ExpoZoneCode) => {
    if (zone === selectedZone) {
      onReset();
      return;
    }
    onZoneSelect(zone);
  };

  return (
    <div aria-label={copy.zoneControls} className="space-y-3 @container">
      <div className="grid grid-cols-1 gap-2 @min-[30rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        {EXPO_ZONE_DEFINITIONS.map((definition) => {
          const state = resolveExpoZoneVisualState({
            zone: definition.code,
            selectedZone,
            highlightedZones,
          });
          const count = zoneCounts[definition.code] ?? 0;

          return (
            <Button
              aria-pressed={state === "selected"}
              className={cn(
                "min-h-12 justify-between gap-3 text-left",
                state === "secondary" && "opacity-65",
              )}
              key={definition.code}
              onClick={() => activateZone(definition.code)}
              type="button"
              variant={state === "selected" ? "primary" : "secondary"}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full border border-foreground/20"
                  style={{ backgroundColor: definition.color }}
                />
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{definition.code}</span>{" "}
                  <span className="type-metadata">{zoneName(definition)}</span>
                </span>
              </span>
              <Badge variant={state === "selected" ? "default" : "outline"}>
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={textStyles({ variant: "caption" })}>{copy.allZones}</p>
        <Button onClick={onReset} size="compact" type="button" variant="ghost">
          <RotateCcw aria-hidden="true" />
          {copy.reset}
        </Button>
      </div>
    </div>
  );
}

function MapLegend({
  selectedZone,
  highlightedZones,
  copy,
}: Pick<
  TaiwanCreativeExpoFloorMapProps,
  "selectedZone" | "highlightedZones"
> & {
  copy: FloorMapCopy;
}) {
  const states: ReadonlyArray<{
    color: string;
    label: string;
    state: ExpoZoneVisualState;
  }> = [
    {
      color: "var(--color-primary)",
      label: copy.selected,
      state: "selected",
    },
    {
      color: "var(--color-info)",
      label: copy.highlighted,
      state: "highlighted",
    },
    {
      color: "var(--color-muted-foreground)",
      label: copy.secondary,
      state: "secondary",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {states.map(({ color, label, state }) => {
        const active =
          state === "selected"
            ? selectedZone !== null
            : state === "highlighted"
              ? selectedZone === null && (highlightedZones?.length ?? 0) > 0
              : selectedZone !== null;
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 type-caption",
              !active && "opacity-55",
            )}
            key={state}
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border border-foreground/20"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        );
      })}
      <span className="type-caption opacity-70">{copy.nonInteractive}</span>
    </div>
  );
}

export function TaiwanCreativeExpoFloorMap({
  selectedZone,
  highlightedZones = [],
  zoneCounts,
  onZoneSelect,
  onReset,
}: TaiwanCreativeExpoFloorMapProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();

  const selectedDefinition = selectedZone
    ? EXPO_ZONE_DEFINITIONS.find(({ code }) => code === selectedZone)
    : undefined;

  const rememberTriggerFocus = () => {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
  };

  const handleViewerOpenChange = (nextOpen: boolean) => {
    setViewerOpen(nextOpen);
    if (nextOpen) {
      setZoom(selectedZone ? 2 : 1);
      return;
    }

    const previousFocus = previousFocusRef.current;
    if (previousFocus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => previousFocus.focus());
    }
  };

  useEffect(() => {
    if (!viewerOpen) return;

    const focus = selectedDefinition?.focus;
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      if (!focus) {
        viewport.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }

      const targetX =
        ((focus.x + focus.width / 2) / EXPO_FLOOR_MAP_GEOMETRY.width) *
        viewport.scrollWidth;
      const targetY =
        ((focus.y + focus.height / 2) / EXPO_FLOOR_MAP_GEOMETRY.height) *
        viewport.scrollHeight;
      const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const left = Math.min(
        maxLeft,
        Math.max(0, targetX - viewport.clientWidth / 2),
      );
      const top = Math.min(
        maxTop,
        Math.max(0, targetY - viewport.clientHeight / 2),
      );
      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
        true;

      viewport.scrollTo({
        behavior: reducedMotion ? "auto" : "smooth",
        left,
        top,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedDefinition, viewerOpen, zoom]);

  const handleImageError = () => setImageFailed(true);
  const t = useTranslations("events");
  const locale = useLocale();
  const copy: FloorMapCopy = {
    heading: t("floorMapHeading"),
    description: t("floorMapDescription"),
    mapLabel: t("floorMapLabel"),
    zoneControls: t("floorMapZoneControls"),
    selected: t("floorMapSelected"),
    highlighted: t("floorMapHighlighted"),
    secondary: t("floorMapSecondary"),
    reset: t("floorMapReset"),
    openViewer: t("floorMapOpenViewer"),
    viewerTitle: t("floorMapViewerTitle"),
    viewerDescription: t("floorMapViewerDescription"),
    closeViewer: t("floorMapCloseViewer"),
    zoom: t("floorMapZoom"),
    fit: t("floorMapFit"),
    zoomTimes: (value) => t("floorMapZoomTimes", { value }),
    mapUnavailable: t("floorMapUnavailable"),
    mapUnavailableHint: t("floorMapUnavailableHint"),
    noScript: t("floorMapNoScript"),
    officialPdf: t("floorMapOfficialPdf"),
    attribution: t("floorMapAttribution"),
    officialSite: t("floorMapOfficialSite"),
    allZones: t("floorMapAllZones"),
    nonInteractive: t("floorMapNonInteractive"),
  };
  const zoneName = (definition: ExpoZoneDefinition) =>
    locale === "en" ? definition.names.en : definition.names.zhTW;

  return (
    <section aria-labelledby={headingId} className="space-y-5">
      <header className="space-y-2">
        <h2 className={textStyles({ variant: "sectionTitle" })} id={headingId}>
          {copy.heading}
        </h2>
        <p className={textStyles({ variant: "sectionDescription" })}>
          {copy.description}
        </p>
      </header>

      <ZoneControls
        copy={copy}
        highlightedZones={highlightedZones}
        onReset={onReset}
        onZoneSelect={onZoneSelect}
        selectedZone={selectedZone}
        zoneCounts={zoneCounts}
        zoneName={zoneName}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MapLegend
            copy={copy}
            highlightedZones={highlightedZones}
            selectedZone={selectedZone}
          />
          <Dialog open={viewerOpen} onOpenChange={handleViewerOpenChange}>
            <DialogTrigger
              onClick={rememberTriggerFocus}
              render={
                <Button size="compact" type="button" variant="secondary" />
              }
            >
              <Maximize2 aria-hidden="true" />
              {copy.openViewer}
            </DialogTrigger>
            <DialogContent
              className="h-[100dvh] w-screen max-w-none gap-0 rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-[min(96vw,1100px)] sm:rounded-xl"
              showCloseButton={false}
            >
              <DialogHeader className="flex-row items-start justify-between gap-3 border-b p-4 sm:p-5">
                <div className="min-w-0 space-y-1">
                  <DialogTitle>{copy.viewerTitle}</DialogTitle>
                  <DialogDescription>
                    {copy.viewerDescription}
                  </DialogDescription>
                </div>
                <DialogClose
                  render={
                    <Button
                      aria-label={copy.closeViewer}
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
                aria-label={copy.mapLabel}
                className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted p-2 touch-pan-x touch-pan-y sm:p-4"
                ref={viewportRef}
                role="region"
                tabIndex={0}
              >
                <div
                  className="relative min-w-full"
                  style={{ width: `${zoom * 100}%` }}
                >
                  <MapImage
                    copy={copy}
                    highlightedZones={highlightedZones}
                    imageFailed={imageFailed}
                    onImageError={handleImageError}
                    onReset={onReset}
                    onZoneSelect={onZoneSelect}
                    selectedZone={selectedZone}
                    zoneName={zoneName}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background p-3 sm:p-4">
                <span className={textStyles({ variant: "caption" })}>
                  {copy.zoom}
                </span>
                <div className="flex flex-wrap gap-2">
                  {ZOOM_LEVELS.map((level) => (
                    <Button
                      aria-label={
                        level === 1 ? copy.fit : copy.zoomTimes(level)
                      }
                      aria-pressed={zoom === level}
                      className="min-h-12 min-w-12 px-2"
                      key={level}
                      onClick={() => setZoom(level)}
                      size="default"
                      type="button"
                      variant={zoom === level ? "primary" : "secondary"}
                    >
                      {level === 1 ? (
                        copy.fit
                      ) : (
                        <span aria-hidden="true">{copy.zoomTimes(level)}</span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="rounded-xl border bg-card p-1 shadow-xs">
          <MapImage
            copy={copy}
            highlightedZones={highlightedZones}
            imageFailed={imageFailed}
            onImageError={handleImageError}
            onReset={onReset}
            onZoneSelect={onZoneSelect}
            selectedZone={selectedZone}
            zoneName={zoneName}
          />
        </div>
      </div>

      <footer className="space-y-2 border-t pt-4">
        <p className={textStyles({ variant: "caption" })}>{copy.attribution}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <a
            className={textStyles({ variant: "link" })}
            href={EXPO_FLOOR_MAP_ASSET.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            {copy.officialPdf}
            <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5" />
          </a>
          <a
            className={textStyles({ variant: "link" })}
            href="https://creativexpo.tw/"
            rel="noreferrer"
            target="_blank"
          >
            {copy.officialSite}
            <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5" />
          </a>
        </div>
      </footer>

      <noscript>
        <div className="rounded-xl border border-dashed p-4">
          <p className={textStyles({ variant: "cardDescription" })}>
            {copy.noScript}
          </p>
          <a
            className={textStyles({ variant: "link" })}
            href={EXPO_FLOOR_MAP_ASSET.sourceUrl}
          >
            {copy.officialPdf}
          </a>
        </div>
      </noscript>
    </section>
  );
}
