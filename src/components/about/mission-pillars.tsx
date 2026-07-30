import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Pillar {
  heading: string;
  body: string;
}

interface MissionPillarsProps {
  heading: string;
  statement: string;
  pillars: [Pillar, Pillar, Pillar];
  cta?: ReactNode;
  variant?: "default" | "sequence";
}

export default function MissionPillars({
  heading,
  statement,
  pillars,
  cta,
  variant = "default",
}: MissionPillarsProps) {
  return (
    <section className="py-12 md:py-16">
      <div className="page-gutter mx-auto max-w-6xl">
        <h2 className="type-section-title-large text-balance">{heading}</h2>
        <p className="mt-4 max-w-3xl type-page-subtitle text-pretty">
          {statement}
        </p>
        <div
          className={cn(
            "mt-8",
            variant === "sequence"
              ? "grid gap-6 md:grid-cols-3 md:gap-0"
              : "max-w-3xl space-y-6",
          )}
        >
          {pillars.map((pillar, index) => (
            <article
              key={pillar.heading}
              className={cn(
                variant === "sequence" &&
                  "border-l border-border pl-5 md:border-l-0 md:border-t md:px-5 md:pt-5 md:first:pl-0 md:last:pr-0",
              )}
            >
              {variant === "sequence" ? (
                <p className="type-eyebrow text-primary">
                  {String(index + 1).padStart(2, "0")}
                </p>
              ) : null}
              <h3 className="type-card-title text-cta">{pillar.heading}</h3>
              <p className="mt-2 type-body-muted text-pretty">{pillar.body}</p>
            </article>
          ))}
        </div>
        {cta ? <div className="mt-8">{cta}</div> : null}
      </div>
    </section>
  );
}
