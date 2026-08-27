"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AutoScroll from "embla-carousel-auto-scroll";
import useEmblaCarousel from "embla-carousel-react";
import { Pause, Play } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";
import { Button } from "@/components/ui/button";

type MarqueeBrand = {
  id: string;
  name: string;
  href: string;
  imageSrc: string | null;
  isLogo?: boolean;
};

type BrandMarqueeProps = {
  brands: MarqueeBrand[];
  labels: { pause: string; resume: string };
};

export default function BrandMarquee({ brands, labels }: BrandMarqueeProps) {
  const interactionStopped = useRef(false);
  const [canScroll, setCanScroll] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
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
        stopOnFocusIn: true,
        stopOnInteraction: true,
      }),
    ],
  );

  const stopAfterInteraction = useCallback(() => {
    interactionStopped.current = true;
    emblaApi?.plugins().autoScroll?.stop();
    setIsPlaying(false);
  }, [emblaApi]);

  const togglePlayback = useCallback(() => {
    if (!emblaApi) return;

    const autoScroll = emblaApi.plugins().autoScroll;
    if (autoScroll.isPlaying()) {
      interactionStopped.current = true;
      autoScroll.stop();
      setIsPlaying(false);
      return;
    }

    interactionStopped.current = false;
    autoScroll.play(0);
    setIsPlaying(true);
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const autoScroll = emblaApi.plugins().autoScroll;

    const syncPlayback = () => setIsPlaying(autoScroll.isPlaying());
    const syncLayout = () => {
      const scrollable =
        emblaApi.containerNode().scrollWidth > emblaApi.rootNode().clientWidth;

      setCanScroll(scrollable);
      setReducedMotion(motionPreference.matches);

      if (
        !scrollable ||
        motionPreference.matches ||
        interactionStopped.current
      ) {
        autoScroll.stop();
        setIsPlaying(false);
        return;
      }

      autoScroll.play(0);
      setIsPlaying(true);
    };

    emblaApi
      .on("reInit", syncLayout)
      .on("autoScroll:play", syncPlayback)
      .on("autoScroll:stop", syncPlayback);
    motionPreference.addEventListener("change", syncLayout);
    syncLayout();

    return () => {
      emblaApi
        .off("reInit", syncLayout)
        .off("autoScroll:play", syncPlayback)
        .off("autoScroll:stop", syncPlayback);
      motionPreference.removeEventListener("change", syncLayout);
    };
  }, [emblaApi]);

  return (
    <div className="mt-8 flex items-center gap-4">
      {canScroll && !reducedMotion ? (
        <Button
          type="button"
          variant="ghost"
          shape="pill"
          size="large"
          className="aspect-square px-0"
          aria-label={isPlaying ? labels.pause : labels.resume}
          title={isPlaying ? labels.pause : labels.resume}
          onClick={togglePlayback}
        >
          {isPlaying ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </Button>
      ) : null}

      <div
        ref={emblaRef}
        className="min-w-0 flex-1 overflow-hidden"
        onMouseEnter={stopAfterInteraction}
        onFocusCapture={stopAfterInteraction}
        onPointerDown={stopAfterInteraction}
      >
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
                    className={`rounded-full ${brand.isLogo ? "bg-surface-deep object-contain" : "object-cover"}`}
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
    </div>
  );
}
