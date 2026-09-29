import { SurfaceImage } from "@/components/ui/image";
import { cn } from "@/lib/utils";

export function BrandAvatar({
  name,
  imageSrc,
  nameFace = "interface",
}: {
  name: string;
  imageSrc: string | null;
  nameFace?: "content" | "interface";
}) {
  return (
    <>
      {imageSrc ? (
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface">
          <SurfaceImage
            src={imageSrc}
            alt=""
            fill
            surface="thumb"
            className="object-cover"
          />
        </div>
      ) : (
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-deep"
          aria-hidden="true"
        >
          <span className="type-metadata text-ink-soft">{name.charAt(0)}</span>
        </div>
      )}
      <span
        className={cn(
          "mt-1 line-clamp-1 text-ink-soft text-center",
          nameFace === "content" ? "type-body-sm" : "type-metadata",
        )}
      >
        {name}
      </span>
    </>
  );
}
