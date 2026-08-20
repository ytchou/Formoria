import type { ComponentProps, ReactNode } from "react";
import { SurfaceCard } from "@/components/ui/card";
import { Grid } from "@/components/ui/grid";
import { cn } from "@/lib/utils";

interface AboutCardGridProps {
  children: ReactNode;
  className?: string;
}

interface AboutCardContentProps {
  eyebrow: ReactNode;
  heading: ReactNode;
  body?: ReactNode;
}

type AboutCardProps = Omit<
  ComponentProps<typeof SurfaceCard>,
  "padding" | "tone"
>;

/**
 * Three-up by default, through the shared grid primitive rather than a
 * hand-written `grid-cols-*` triple. Callers that want two columns pass
 * `md:grid-cols-2` and tailwind-merge resolves it against `triptych`.
 */
export function AboutCardGrid({ children, className }: AboutCardGridProps) {
  return (
    <Grid cols="triptych" className={cn("mt-stack", className)}>
      {children}
    </Grid>
  );
}

/**
 * `bg-ground` on purpose: these cards sit inside a `bg-surface` band, so paper
 * is what separates them from it. Elevation is the rule around the card, never
 * a shadow.
 */
export function AboutCard({ className, ...props }: AboutCardProps) {
  return (
    <SurfaceCard
      padding="lg"
      className={cn("h-full bg-ground", className)}
      {...props}
    />
  );
}

export function AboutCardContent({
  eyebrow,
  heading,
  body,
}: AboutCardContentProps) {
  return (
    <>
      <p className="type-eyebrow tabular-nums text-accent">{eyebrow}</p>
      <h3 className="mt-5 type-card-title">{heading}</h3>
      {body ? (
        <p className="mt-3 type-body-sm text-ink-soft text-pretty">{body}</p>
      ) : null}
    </>
  );
}
