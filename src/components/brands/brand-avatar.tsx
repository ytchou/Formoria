import { SurfaceImage } from "@/components/ui/image";
import { cn } from "@/lib/utils";

export function BrandAvatar({
  name,
  imageSrc,
  nameFace = "interface",
  size = "sm",
  showName = true,
  preload,
}: {
  name: string;
  imageSrc: string | null;
  nameFace?: "content" | "interface";
  size?: "sm" | "lg";
  /** Off where the caller renders the name itself (the directory card's h3). */
  showName?: boolean;
  /** Forwarded to the image; the directory's first card is the LCP candidate. */
  preload?: boolean;
}) {
  const circle = size === "lg" ? "h-20 w-20" : "h-11 w-11";
  return (
    <>
      {imageSrc ? (
        <div
          className={cn(
            "relative shrink-0 overflow-hidden rounded-full bg-surface",
            circle,
          )}
        >
          <SurfaceImage
            src={imageSrc}
            alt=""
            fill
            preload={preload}
            surface="thumb"
            // The lg circle measures 80px; `thumb` alone would hint 72px.
            sizes={size === "lg" ? "80px" : undefined}
            className="object-cover"
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
