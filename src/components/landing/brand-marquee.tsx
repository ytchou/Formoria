"use client";

import { useEffect } from "react";
import AutoScroll from "embla-carousel-auto-scroll";
import useEmblaCarousel from "embla-carousel-react";
import { Link } from "@/i18n/navigation";
import { BrandAvatar } from "@/components/brands/brand-avatar";

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
              <BrandAvatar name={brand.name} imageSrc={brand.imageSrc} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
