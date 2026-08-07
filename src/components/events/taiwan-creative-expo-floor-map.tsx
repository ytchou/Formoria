"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Link } from "@/i18n/navigation";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { cn } from "@/lib/utils";
import type { LinkedEventExhibitorEntry } from "@/lib/services/events";
import geometry from "../../../content/events/2026-taiwan-creative-expo.block-geometry.json";
import {
  EXPO_FLOOR_MAP_ASSET,
  EXPO_FLOOR_MAP_GEOMETRY,
  EXPO_ZONE_DEFINITIONS,
  resolveExpoZoneVisualState,
  type ExpoZoneCode,
  type ExpoZoneDefinition,
  type ExpoZoneVisualState,
} from "./taiwan-creative-expo-floor-map-config";

type Block = (typeof geometry.blocks)[number];
type Bounds = Readonly<{ x: number; y: number; width: number; height: number }>;

export type TaiwanCreativeExpoFloorMapProps = {
  selectedZone: ExpoZoneCode | null;
  selectedBooth: string | null;
  hoveredBooth: string | null;
  highlightedZones?: readonly ExpoZoneCode[];
  zoneCounts: Readonly<Record<ExpoZoneCode, number>>;
  entries: readonly LinkedEventExhibitorEntry[];
  visibleBooths: readonly string[];
  onZoneSelect: (zone: ExpoZoneCode) => void;
  onBoothSelect: (
    booth: string,
    zone: ExpoZoneCode,
    brandCount: number,
  ) => void;
  onBoothHover: (booth: string | null) => void;
  onReset: () => void;
};

type ZoomLevel = 1 | 2 | 4 | 8;

const ZOOM_LEVELS: readonly ZoomLevel[] = [1, 2, 4, 8];

/** Fraction of the framed viewport the focused zone occupies, leaving a margin. */
const FRAME_FILL = 0.92;

/**
 * The inline map is a fixed 16/9 window onto the same user-coordinate system the
 * zone polygons and block rects already share. The source geometry is 3200x2450
 * (~1.306), so the window is widened horizontally and centred rather than cropped.
 * Matching the container's aspect ratio exactly means `xMidYMid meet` letterboxes
 * nothing, which in turn lets the popover project a block rect to a container
 * percentage with plain arithmetic instead of a DOM measurement.
 */
const MIN_FRAME_ASPECT = 0.72;
const MAX_FRAME_ASPECT = 16 / 9;

/**
 * The card's aspect follows whatever is framed. The union of the four zone
 * focus rects is portrait (~0.75), so a fixed 16/9 card rendered the overview
 * ~506px wide inside 1200px and gave back the horizontal space this map exists
 * to reclaim. Clamped at both ends: below the floor a zone reads as a sliver,
 * above the ceiling the card outgrows the column.
 */
function clampFrameAspect(focus: Bounds): number {
  return Math.min(
    MAX_FRAME_ASPECT,
    Math.max(MIN_FRAME_ASPECT, focus.width / focus.height),
  );
}

/**
 * The visible window onto the user-coordinate system the zone polygons and
 * block rects already share, widened or narrowed around the geometry's centre.
 *
 * This MUST be derived from the same aspect the container is sized to. If the
 * two drift apart, `xMidYMid meet` starts letterboxing and `popoverPosition`
 * silently anchors to the wrong place — it projects through this window with
 * plain arithmetic precisely because the fit is exact.
 */
function resolveView(aspect: number): Bounds {
  const height = EXPO_FLOOR_MAP_GEOMETRY.height;
  const width = height * aspect;
  return {
    x: (EXPO_FLOOR_MAP_GEOMETRY.width - width) / 2,
    y: 0,
    width,
    height,
  };
}

/** Fit-all framing: the union of the four zone focus rects. */
const OVERVIEW_FOCUS: Bounds = (() => {
  const left = Math.min(...EXPO_ZONE_DEFINITIONS.map((zone) => zone.focus.x));
  const top = Math.min(...EXPO_ZONE_DEFINITIONS.map((zone) => zone.focus.y));
  const right = Math.max(
    ...EXPO_ZONE_DEFINITIONS.map((zone) => zone.focus.x + zone.focus.width),
  );
  const bottom = Math.max(
    ...EXPO_ZONE_DEFINITIONS.map((zone) => zone.focus.y + zone.focus.height),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
})();

type Frame = Readonly<{ scale: number; tx: number; ty: number }>;

function resolveFrame(focus: Bounds, view: Bounds): Frame {
  const scale =
    Math.min(view.width / focus.width, view.height / focus.height) * FRAME_FILL;
  return {
    scale,
    tx: view.x + view.width / 2 - (focus.x + focus.width / 2) * scale,
    ty: view.y + view.height / 2 - (focus.y + focus.height / 2) * scale,
  };
}

/**
 * CSS `transform`, not the SVG `transform` attribute: only the CSS property is
 * transitionable. That makes the units load-bearing — the SVG attribute accepts
 * `translate(120 40)`, but CSS rejects it and drops the whole declaration, which
 * silently disables framing. `px` under the default `transform-box: view-box`
 * resolves to user units.
 */
function frameStyle(frame: Frame): React.CSSProperties {
  return {
    transform: `translate(${frame.tx}px, ${frame.ty}px) scale(${frame.scale})`,
    transformOrigin: "0 0",
  };
}

function stateOpacity(state: ExpoZoneVisualState): number {
  if (state === "selected") return 0.32;
  if (state === "highlighted") return 0.22;
  if (state === "secondary") return 0.06;
  return 0.1;
}

function stateStrokeWidth(state: ExpoZoneVisualState): number {
  if (state === "selected") return 18;
  if (state === "highlighted") return 12;
  return 8;
}

function pointsToString(definition: ExpoZoneDefinition): string {
  return definition.polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

type FloorMapCopy = {
  heading: string;
  description: string;
  mapLabel: string;
  zoneControls: string;
  selected: string;
  highlighted: string;
  secondary: string;
  ghost: string;
  nonInteractive: string;
  reset: string;
  hint: string;
  blockGroup: string;
  blockAria: (booth: string, brand: string) => string;
  popoverTitle: string;
  viewBrand: string;
  multiBrand: string;
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
};

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
                  {/* `type-metadata` bakes in muted-foreground, which is
                      near-invisible once the button flips to `primary`. Same
                      pairing as the active page chip in brands/pagination. */}
                  <span
                    className={cn(
                      "type-metadata",
                      state === "selected" && "text-primary-foreground",
                    )}
                  >
                    {zoneName(definition)}
                  </span>
                </span>
              </span>
              <Badge variant={state === "selected" ? "default" : "outline"}>
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
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
> & { copy: FloorMapCopy }) {
  const states: ReadonlyArray<{
    color: string;
    label: string;
    state: ExpoZoneVisualState;
  }> = [
    { color: "var(--color-primary)", label: copy.selected, state: "selected" },
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
      <span className="type-caption opacity-70">{copy.ghost}</span>
      <span className="type-caption opacity-70">{copy.nonInteractive}</span>
    </div>
  );
}

/** The 797KB raster now renders only here, behind the fullscreen viewer. */
function OfficialMapImage({
  imageFailed,
  onImageError,
  copy,
}: {
  imageFailed: boolean;
  onImageError: () => void;
  copy: FloorMapCopy;
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
        sizes="(max-width: 640px) 100vw, 1200px"
        src={EXPO_FLOOR_MAP_ASSET.src}
      />
      {imageFailed ? (
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
      ) : null}
    </div>
  );
}

export function TaiwanCreativeExpoFloorMap({
  selectedZone,
  selectedBooth,
  hoveredBooth,
  highlightedZones = [],
  zoneCounts,
  entries,
  visibleBooths,
  onZoneSelect,
  onBoothSelect,
  onBoothHover,
  onReset,
}: TaiwanCreativeExpoFloorMapProps) {
  const t = useTranslations("events");
  const locale = useLocale();
  const [imageFailed, setImageFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [dismissedBooth, setDismissedBooth] = useState<string | null>(null);
  const blockRefs = useRef<Array<SVGRectElement | null>>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const titleId = useId();

  const copy: FloorMapCopy = {
    heading: t("floorMapHeading"),
    description: t("floorMapDescription"),
    mapLabel: t("floorMapLabel"),
    zoneControls: t("floorMapZoneControls"),
    selected: t("floorMapSelected"),
    highlighted: t("floorMapHighlighted"),
    secondary: t("floorMapSecondary"),
    ghost: t("floorMapGhost"),
    nonInteractive: t("floorMapNonInteractive"),
    reset: t("floorMapReset"),
    hint: t("floorMapHint"),
    blockGroup: t("floorMapBlockGroup"),
    blockAria: (booth, brand) => t("floorMapBlockAria", { booth, brand }),
    popoverTitle: t("floorMapPopoverTitle"),
    viewBrand: t("floorMapViewBrand"),
    multiBrand: t("floorMapMultiBrand"),
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
  };

  const zoneName = (definition: ExpoZoneDefinition) =>
    locale === "en" ? definition.names.en : definition.names.zhTW;

  const entryByBooth = useMemo(() => {
    const index = new Map<string, LinkedEventExhibitorEntry>();
    for (const entry of entries) if (entry.booth) index.set(entry.booth, entry);
    return index;
  }, [entries]);

  const visibleSet = useMemo(() => new Set(visibleBooths), [visibleBooths]);

  /**
   * Linked brands per block, resolved once. `booths: []` and blocks whose booths
   * are all unlinked collapse to an empty list here, which is what makes them
   * ghosts: no fill, no role, no tab stop.
   */
  const blockEntries = useMemo(
    () =>
      geometry.blocks.map((block) =>
        block.booths
          .map((booth) => entryByBooth.get(booth))
          .filter((entry): entry is LinkedEventExhibitorEntry =>
            Boolean(entry),
          ),
      ),
    [entryByBooth],
  );

  /**
   * Roving tabindex over the interactive blocks only. Walking every block would
   * park the single tab stop on a ghost and strand the keyboard user, because a
   * ghost is `aria-hidden` and cannot receive focus.
   */
  const interactiveIndexes = useMemo(
    () =>
      blockEntries.reduce<number[]>((all, entriesForBlock, index) => {
        if (entriesForBlock.length > 0) all.push(index);
        return all;
      }, []),
    [blockEntries],
  );

  const [activeBlock, setActiveBlock] = useState<number | null>(null);
  const rovingIndex = activeBlock ?? interactiveIndexes[0] ?? null;

  const selectedDefinition = selectedZone
    ? EXPO_ZONE_DEFINITIONS.find(({ code }) => code === selectedZone)
    : undefined;
  const focusBounds = selectedDefinition?.focus ?? OVERVIEW_FOCUS;
  const frameAspect = clampFrameAspect(focusBounds);
  const view = useMemo(() => resolveView(frameAspect), [frameAspect]);
  const frame = useMemo(
    () => resolveFrame(focusBounds, view),
    [focusBounds, view],
  );
  const viewBox = `${view.x} ${view.y} ${view.width} ${view.height}`;
  // Height is pinned by the outer box; only the width follows the aspect, so
  // switching zones never shifts the page below the map.
  const frameWidthPercent = Math.min(
    100,
    (frameAspect / MAX_FRAME_ASPECT) * 100,
  );

  /**
   * The popover is derived from `selectedBooth`, never mirrored into state: a
   * copy would need an effect to re-clear itself whenever the explorer cleared
   * the filter, and `react-hooks/set-state-in-effect` rightly rejects that.
   * Dismissal is the only local concern, so it is the only thing stored.
   */
  const popoverIndex =
    selectedBooth !== null && selectedBooth !== dismissedBooth
      ? geometry.blocks.findIndex((block) => block.block === selectedBooth)
      : -1;
  const popoverBlock = popoverIndex >= 0 ? geometry.blocks[popoverIndex] : null;
  const popoverEntries =
    popoverIndex >= 0 ? (blockEntries[popoverIndex] ?? []) : [];
  const dismissPopover = () => setDismissedBooth(selectedBooth);

  useEffect(() => {
    if (!popoverBlock) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissedBooth(popoverBlock.block);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popoverBlock]);

  const activateBlock = (index: number) => {
    const block = geometry.blocks[index];
    const linked = blockEntries[index] ?? [];
    if (!block || linked.length === 0) return;
    setActiveBlock(index);
    setDismissedBooth(null);
    onBoothSelect(block.block, block.zone as ExpoZoneCode, linked.length);
  };

  /** Arrow keys walk `interactiveIndexes`; up/down pick the nearest by centre. */
  const nextIndex = (
    from: number,
    direction: "left" | "right" | "up" | "down" | "home" | "end",
  ): number => {
    if (direction === "home") return interactiveIndexes[0] ?? from;
    if (direction === "end")
      return interactiveIndexes[interactiveIndexes.length - 1] ?? from;

    const position = interactiveIndexes.indexOf(from);
    if (direction === "left" || direction === "right") {
      const step = direction === "left" ? -1 : 1;
      return (
        interactiveIndexes[
          Math.max(0, Math.min(interactiveIndexes.length - 1, position + step))
        ] ?? from
      );
    }

    const current = geometry.blocks[from];
    if (!current) return from;
    const currentY = current.y + current.height / 2;
    const currentX = current.x + current.width / 2;

    return (
      interactiveIndexes
        .filter((candidate) => {
          const block = geometry.blocks[candidate];
          if (!block || candidate === from) return false;
          const centreY = block.y + block.height / 2;
          return direction === "up" ? centreY < currentY : centreY > currentY;
        })
        .map((candidate) => {
          const block = geometry.blocks[candidate]!;
          return {
            candidate,
            distance:
              Math.abs(block.x + block.width / 2 - currentX) +
              Math.abs(block.y + block.height / 2 - currentY),
          };
        })
        .sort((left, right) => left.distance - right.distance)[0]?.candidate ??
      from
    );
  };

  const handleBlockKeyDown = (event: React.KeyboardEvent<SVGGElement>) => {
    if (rovingIndex === null) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateBlock(rovingIndex);
      return;
    }

    const directions = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Home: "home",
      End: "end",
    } as const;
    const direction = directions[event.key as keyof typeof directions];
    if (!direction) return;

    event.preventDefault();
    const next = nextIndex(rovingIndex, direction);
    setActiveBlock(next);
    blockRefs.current[next]?.focus();
  };

  /** Block rect projected through the active frame into container percentages. */
  const popoverPosition = (block: Block) => ({
    left: `${(((block.x + block.width / 2) * frame.scale + frame.tx - view.x) / view.width) * 100}%`,
    top: `${(((block.y + block.height) * frame.scale + frame.ty - view.y) / view.height) * 100}%`,
  });

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

  // Opening the viewer on a selected zone scrolls the raster to that zone.
  useEffect(() => {
    if (!viewerOpen) return;

    const focus = selectedDefinition?.focus;
    const frameId = window.requestAnimationFrame(() => {
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
      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
        true;

      viewport.scrollTo({
        behavior: reducedMotion ? "auto" : "smooth",
        left: Math.min(
          maxLeft,
          Math.max(0, targetX - viewport.clientWidth / 2),
        ),
        top: Math.min(maxTop, Math.max(0, targetY - viewport.clientHeight / 2)),
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedDefinition, viewerOpen, zoom]);

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
                  <OfficialMapImage
                    copy={copy}
                    imageFailed={imageFailed}
                    onImageError={() => setImageFailed(true)}
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

        {/* Outer box reserves a constant height at the widest aspect. */}
        <div className="aspect-[16/9] w-full">
          <div
            className="relative mx-auto h-full overflow-hidden rounded-xl border bg-card shadow-xs transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${frameWidthPercent}%` }}
          >
            <svg
              aria-labelledby={titleId}
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="xMidYMid meet"
              role="group"
              viewBox={viewBox}
            >
              <title id={titleId}>{copy.mapLabel}</title>
              <g
                className="transition-transform duration-500 ease-out motion-reduce:transition-none"
                style={frameStyle(frame)}
              >
                {EXPO_ZONE_DEFINITIONS.map((definition) => {
                  const state = resolveExpoZoneVisualState({
                    zone: definition.code,
                    selectedZone,
                    highlightedZones,
                  });
                  const activate = () =>
                    definition.code === selectedZone
                      ? onReset()
                      : onZoneSelect(definition.code);

                  return (
                    <polygon
                      aria-label={`${definition.code}: ${zoneName(definition)}`}
                      aria-pressed={state === "selected"}
                      className="cursor-pointer outline-none focus-visible:stroke-foreground focus-visible:stroke-[24px]"
                      fill={definition.color}
                      fillOpacity={stateOpacity(state)}
                      key={definition.code}
                      onClick={activate}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          activate();
                        }
                      }}
                      points={pointsToString(definition)}
                      role="button"
                      stroke={definition.color}
                      strokeDasharray={
                        state === "highlighted" ? "34 22" : undefined
                      }
                      strokeOpacity={state === "secondary" ? 0.4 : 0.92}
                      strokeWidth={stateStrokeWidth(state)}
                      tabIndex={0}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}

                <g
                  aria-label={copy.blockGroup}
                  onKeyDown={handleBlockKeyDown}
                  role="group"
                >
                  {geometry.blocks.map((block, index) => {
                    const linked = blockEntries[index] ?? [];
                    const interactive = linked.length > 0;
                    const dimmed =
                      interactive &&
                      !linked.some(
                        (entry) =>
                          entry.booth !== null && visibleSet.has(entry.booth),
                      );
                    const active =
                      (hoveredBooth !== null &&
                        block.booths.includes(hoveredBooth)) ||
                      (selectedBooth !== null &&
                        block.booths.includes(selectedBooth));
                    const brandLabel = linked
                      .map((entry) => entry.brand.name)
                      .join(", ");

                    return (
                      <g key={block.block}>
                        <rect
                          aria-hidden={interactive ? undefined : true}
                          aria-label={
                            interactive
                              ? copy.blockAria(block.block, brandLabel)
                              : undefined
                          }
                          className={cn(
                            interactive
                              ? "cursor-pointer outline-none focus-visible:stroke-foreground"
                              : "pointer-events-none",
                          )}
                          data-block={block.block}
                          fill={interactive ? "var(--color-card)" : "none"}
                          fillOpacity={dimmed ? 0.25 : active ? 0.95 : 0.82}
                          height={block.height}
                          onClick={() => activateBlock(index)}
                          onFocus={() => {
                            setActiveBlock(index);
                            onBoothHover(linked[0]?.booth ?? null);
                          }}
                          onMouseEnter={() =>
                            interactive &&
                            onBoothHover(linked[0]?.booth ?? null)
                          }
                          onMouseLeave={() => interactive && onBoothHover(null)}
                          ref={(element) => {
                            blockRefs.current[index] = element;
                          }}
                          role={interactive ? "button" : undefined}
                          stroke={
                            interactive
                              ? active
                                ? "var(--color-primary)"
                                : "var(--color-foreground)"
                              : "var(--color-muted-foreground)"
                          }
                          strokeDasharray={interactive ? undefined : "8 6"}
                          strokeOpacity={dimmed ? 0.35 : 0.8}
                          strokeWidth={active ? 10 : 5}
                          tabIndex={
                            interactive && index === rovingIndex ? 0 : -1
                          }
                          width={block.width}
                          x={block.x}
                          y={block.y}
                        />
                        {/* Block codes are sub-pixel at overview scale. */}
                        {selectedZone === block.zone ? (
                          <text
                            aria-hidden="true"
                            className="pointer-events-none select-none fill-foreground"
                            dominantBaseline="middle"
                            fontSize={Math.max(
                              12,
                              Math.min(28, block.height * 0.42),
                            )}
                            textAnchor="middle"
                            x={block.x + block.width / 2}
                            y={block.y + block.height / 2}
                          >
                            {block.block}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>

            {popoverBlock && popoverEntries.length > 0 ? (
              <div
                className="absolute z-10 max-h-56 w-64 -translate-x-1/2 overflow-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
                onMouseLeave={dismissPopover}
                style={popoverPosition(popoverBlock)}
              >
                <p className="type-eyebrow-muted">{copy.popoverTitle}</p>
                <p className="mt-1 type-metadata">{popoverBlock.block}</p>
                {popoverEntries.length > 1 ? (
                  <p className="mt-2 type-caption">{copy.multiBrand}</p>
                ) : null}
                <div className="mt-2 space-y-2">
                  {popoverEntries.map((entry) => {
                    const image = safeImageSrc(entry.brand.heroImageUrl);
                    return (
                      <Link
                        className="flex min-h-12 items-center gap-2 rounded-md p-1.5 hover:bg-muted"
                        href={`/brands/${entry.brand.slug}`}
                        key={entry.brand.id}
                      >
                        {image ? (
                          <Image
                            alt=""
                            className="size-8 rounded object-contain"
                            height={32}
                            src={image}
                            width={32}
                          />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block truncate type-metadata">
                            {entry.brand.name}
                          </span>
                          <span className="block type-caption">
                            {copy.viewBrand}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <p className="type-caption">{copy.hint}</p>
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
