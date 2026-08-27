"use client";

import { useEffect } from "react";
import AutoScroll from "embla-carousel-auto-scroll";
import useEmblaCarousel from "embla-carousel-react";
import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";

type MarqueeBrand = {
  id: string;
  name: string;
  href: string;
  imageSrc: string | null;
};

type BrandMarqueeProps = {
  brands: MarqueeBrand[];
};

export default function BrandMarquee({ brands }: BrandMarqueeProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: "start",
      containScroll: false,
      dragFree: true,
      loop: true,
    },
    [
      AutoScroll({
        direction: "forward",
        playOnInit: false,
        speed: 0.5,
        startDelay: 0,
        stopOnFocusIn: false,
        stopOnInteraction: false,
      }),
    ],
  );

  useEffect(() => {
    if (!emblaApi) return;

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const autoScroll = emblaApi.plugins().autoScroll;

    const syncLayout = () => {
      const scrollable =
        emblaApi.containerNode().scrollWidth > emblaApi.rootNode().clientWidth;

      if (!scrollable || motionPreference.matches) {
        autoScroll.stop();
        return;
      }

      autoScroll.play(0);
    };

    emblaApi.on("reInit", syncLayout);
    motionPreference.addEventListener("change", syncLayout);
    syncLayout();

    return () => {
      emblaApi.off("reInit", syncLayout);
      motionPreference.removeEventListener("change", syncLayout);
    };
  }, [emblaApi]);

  return (
    <div ref={emblaRef} className="mt-8 overflow-hidden">
      <ul className="flex gap-6">
        {brands.map((brand) => (
          <li key={brand.id} className="min-w-0 flex-none basis-36">
            <Link
              href={brand.href}
              className="flex flex-col items-center rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
            >
              {brand.imageSrc ? (
                <SurfaceImage
                  src={brand.imageSrc}
                  alt={brand.name}
                  width={44}
                  height={44}
                  surface="thumb"
                  className="rounded-full"
                />
              ) : (
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-deep"
                  aria-hidden="true"
                >
                  <span className="type-metadata text-ink-soft">
                    {brand.name.charAt(0)}
                  </span>
                </div>
              )}
              <span className="mt-1 line-clamp-1 type-metadata text-ink-soft text-center">
                {brand.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
