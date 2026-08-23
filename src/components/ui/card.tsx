import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { textStyles } from "./text-styles";

/**
 * ELEVATION IS THE BORDER. Nothing floats.
 *
 * The `elevated` axis is gone: it existed only to add `shadow-card`, and v2
 * has no shadows at all — a card is distinguished by its rule and its tone,
 * not by a drop shadow. Callers that passed `elevated` fall back to the
 * bordered default, which is what they should have been using.
 */
const surfaceCardStyles = cva(
  "rounded-surface border border-rule text-ink shadow-none",
  {
    variants: {
      tone: {
        card: "bg-card",
        white: "bg-white",
        background: "bg-background",
        info: "border-info/30 bg-info-bg text-info",
        warning: "border-warning/30 bg-warning/10 text-warning",
        success: "border-verified-green/30 bg-verified-green-bg text-verified-green",
      },
      padding: {
        none: "p-0",
        sm: "p-4",
        md: "p-5",
        lg: "p-6",
      },
      interactive: {
        true: "transition-colors hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
        false: "",
      },
    },
    defaultVariants: {
      tone: "card",
      padding: "md",
      interactive: false,
    },
  },
);

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-surface border border-rule bg-card text-ink",
        className,
      )}
      {...props}
    />
  );
}

type SurfaceCardProps = ComponentProps<"div"> &
  VariantProps<typeof surfaceCardStyles>;

function SurfaceCard({
  className,
  interactive,
  padding,
  tone,
  ...props
}: SurfaceCardProps) {
  return (
    <div
      data-slot="surface-card"
      className={cn(
        surfaceCardStyles({ interactive, padding, tone }),
        className,
      )}
      {...props}
    />
  );
}

type DataCardProps = Omit<SurfaceCardProps, "children"> & {
  children?: ReactNode;
  delta?: {
    direction: "up" | "down" | "flat";
    text: string;
  };
  description?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}

function DataCard({
  children,
  delta,
  description,
  label,
  padding = "sm",
  value,
  ...props
}: DataCardProps) {
  return (
    <SurfaceCard padding={padding} {...props}>
      <p className={textStyles({ variant: "metadata" })}>{label}</p>
      <div className="mt-2">
        <div className={textStyles({ variant: "stat" })}>{value}</div>
        {delta ? (
          <p
            className={cn(
              "mt-2 text-xs",
              delta.direction === "up"
                ? "text-verified-green"
                : "text-muted-foreground",
            )}
            data-direction={delta.direction}
          >
            {delta.text}
          </p>
        ) : null}
        {description ? (
          <p className={cn("mt-2", textStyles({ variant: "cardDescription" }))}>
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </SurfaceCard>
  );
}

function InfoField({
  className,
  label,
  labelClassName,
  layout = "stacked",
  value,
  wide = false,
}: {
  className?: string;
  label: ReactNode;
  labelClassName?: string;
  layout?: "inline" | "stacked";
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        layout === "inline" ? "grid grid-cols-3 items-start gap-x-4" : "space-y-1",
        wide && "sm:col-span-2",
        className,
      )}
    >
      <dt className={labelClassName ?? cn(textStyles({ variant: "fieldLabel" }), "font-bold")}>{label}</dt>
      <dd
        className={cn(
          "whitespace-pre-wrap break-words",
          layout === "inline" && "col-span-2",
          textStyles({ variant: "fieldValue" }),
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function InfoGroup({
  children,
  className,
  description,
  label,
}: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1">
        <h3 className={cn(textStyles({ variant: "fieldLabel" }), "font-bold")}>{label}</h3>
        {description ? (
          <p className={textStyles({ variant: "formHint" })}>{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(textStyles({ variant: "cardTitle" }), className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("p-6 pt-0", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataCard,
  InfoField,
  InfoGroup,
  SurfaceCard,
  surfaceCardStyles,
};
