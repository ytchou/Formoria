"use client";

import { useState } from "react";
import { SurfaceImage } from "@/components/ui/image";
import { cn } from "@/lib/utils";

export function BrandAvatar({
  name,
  imageSrc,
  nameFace = "interface",
  size = "sm",
  showName = true,
  imageFit = "cover",
  preload,
}: {
  name: string;
  imageSrc: string | null;
  nameFace?: "content" | "interface";
  size?: "sm" | "lg";
  /** Off where the caller renders the name itself (the directory card's h3). */
  showName?: boolean;
  /** `contain` for a brand logo, which a cover crop would cut into. */
  imageFit?: "cover" | "contain";
  /** Forwarded to the image; the directory's first card is the LCP candidate. */
  preload?: boolean;
}) {
  const circle = size === "lg" ? "h-20 w-20" : "h-11 w-11";
  // Remembers WHICH src failed rather than a boolean, so a new `imageSrc`
  // gets a fresh attempt without an effect to reset the flag.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!imageSrc && imageSrc !== failedSrc;
  return (
    <>
      {showImage ? (
        <div
          className={cn(
            "relative shrink-0 overflow-hidden rounded-full bg-surface",
            circle,
          )}
        >
          <SurfaceImage
            src={imageSrc}
            alt=""
            preload={preload}
            // A fixed box rather than `fill` + a px `sizes`: Next then emits a
            // 1x/2x srcSet instead of every configured width (DEV-1972). The lg
            // circle measures 80px. The sm circle measures 44px but keeps the
            // 72px `thumb` box, so its 2x candidate stays 256w and a 3x phone
            // still gets a sharp circle. The classes stretch it over the circle
            // exactly as `fill` did.
            width={size === "lg" ? 80 : 72}
            height={size === "lg" ? 80 : 72}
            className={cn(
              "absolute inset-0 h-full w-full",
              imageFit === "contain" ? "object-contain p-2" : "object-cover",
            )}
            onError={() => setFailedSrc(imageSrc)}
          />
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-surface-deep",
            circle,
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              "text-ink-soft",
              size === "lg" ? "type-card-title" : "type-metadata",
            )}
          >
            {name.charAt(0)}
          </span>
        </div>
      )}
      {showName ? (
        <span
          className={cn(
            "line-clamp-1 text-ink-soft text-center",
            size === "lg" ? "mt-2" : "mt-1",
            nameFace === "content" ? "type-body-sm" : "type-metadata",
          )}
        >
          {name}
        </span>
      ) : null}
    </>
  );
}
