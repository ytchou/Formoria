"use client";

import { useEffect, useRef, useState } from "react";
import AutoScroll from "embla-carousel-auto-scroll";
import useEmblaCarousel from "embla-carousel-react";
import { Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandAvatar } from "@/components/brands/brand-avatar";
import { Button } from "@/components/ui/button";

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
  const t = useTranslations("landing.brands");
  // WCAG 2.2.2: moving content needs a user pause that sticks. The ref is
  // what the Embla listeners read; the state drives the button label.
  const userPausedRef = useRef(false);
  const [userPaused, setUserPaused] = useState(false);
  // Nothing to pause when the rail fits or reduced motion is on.
  const [canPause, setCanPause] = useState(false);
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
        stopOnInteraction: false,
        stopOnMouseEnter: true,
      }),
    ],
  );

  useEffect(() => {
    if (!emblaApi) return;

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const autoScroll = emblaApi.plugins().autoScroll;

    const mayRun = () =>
      emblaApi.containerNode().scrollWidth > emblaApi.rootNode().clientWidth &&
      !motionPreference.matches;

    const syncLayout = () => {
      const runnable = mayRun();
      setCanPause(runnable);

      if (!runnable || userPausedRef.current) {
        autoScroll.stop();
        return;
      }

      autoScroll.play(0);
    };

    // The plugin resumes by itself on mouseleave, focusout, and drag settle,
    // regardless of a user pause or reduced motion. It emits
    // `autoScroll:play` before it marks itself active, so a synchronous
    // stop() is a no-op; one microtask later it is active, and stop() also
    // clears the start timer before the first frame scrolls.
    const holdStopped = () => {
      if (userPausedRef.current || !mayRun()) {
        queueMicrotask(() => autoScroll.stop());
      }
    };

    // First sync on the next frame, as ProductShelf does: a synchronous
    // setState in the effect body trips react-hooks/set-state-in-effect.
    const frame = requestAnimationFrame(syncLayout);
    emblaApi.on("reInit", syncLayout);
    emblaApi.on("autoScroll:play", holdStopped);
    motionPreference.addEventListener("change", syncLayout);

    return () => {
      cancelAnimationFrame(frame);
      emblaApi.off("reInit", syncLayout);
      emblaApi.off("autoScroll:play", holdStopped);
      motionPreference.removeEventListener("change", syncLayout);
    };
  }, [emblaApi]);

  const togglePause = () => {
    const paused = !userPausedRef.current;
    userPausedRef.current = paused;
    setUserPaused(paused);

    const autoScroll = emblaApi?.plugins().autoScroll;
    if (!autoScroll) return;
    if (paused) {
      autoScroll.stop();
    } else {
      autoScroll.play(0);
    }
  };

  return (
    <div className="mt-8">
      <div ref={emblaRef} className="overflow-hidden">
        {/* Slide padding, not `gap`: Embla's loop does not measure a flex gap,
            so the seam between the last and first slide lost 24px and the
            spacing visibly jumped once per cycle. Same shape as ProductShelf. */}
        <ul className="-ml-6 flex">
          {brands.map((brand) => (
            <li key={brand.id} className="min-w-0 flex-none basis-44 pl-6">
              <Link
                href={brand.href}
                className="flex flex-col items-center rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
              >
                <BrandAvatar
                  name={brand.name}
                  imageSrc={brand.imageSrc}
                  size="lg"
                  nameFace="content"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {canPause && (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            aria-label={userPaused ? t("playMarquee") : t("pauseMarquee")}
            onClick={togglePause}
          >
            {userPaused ? (
              <Play aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
