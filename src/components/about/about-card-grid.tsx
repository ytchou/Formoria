import type { ComponentProps, ReactNode } from "react";
import { SurfaceCard } from "@/components/ui/card";
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

export function AboutCardGrid({ children, className }: AboutCardGridProps) {
  return (
    <div
      className={cn("mt-8 grid grid-cols-1 gap-4 md:grid-cols-3", className)}
    >
      {children}
    </div>
  );
}

export function AboutCard({ className, ...props }: AboutCardProps) {
  return (
    <SurfaceCard
      tone="background"
      padding="lg"
      className={cn("h-full", className)}
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
      <p className="type-eyebrow tabular-nums text-primary">{eyebrow}</p>
      <h3 className="mt-5 type-card-title">{heading}</h3>
      {body ? (
        <p className="mt-3 type-page-subtitle text-pretty">{body}</p>
      ) : null}
    </>
  );
}
