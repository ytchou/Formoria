import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { textStyles } from "./text-styles";

const surfaceCardStyles = cva(
  "rounded-xl border border-border text-card-foreground shadow-none",
  {
    variants: {
      tone: {
        card: "bg-card",
        white: "bg-white",
        background: "bg-background",
      },
      padding: {
        none: "p-0",
        sm: "p-4",
        md: "p-5",
        lg: "p-6",
      },
      interactive: {
        true: "transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        false: "",
      },
      elevated: {
        true: "shadow-card",
        false: "",
      },
    },
    defaultVariants: {
      tone: "card",
      padding: "md",
      interactive: false,
      elevated: false,
    },
  },
);

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground rounded-xl border shadow-card",
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
  elevated,
  interactive,
  padding,
  tone,
  ...props
}: SurfaceCardProps) {
  return (
    <div
      data-slot="surface-card"
      className={cn(
        surfaceCardStyles({ elevated, interactive, padding, tone }),
        className,
      )}
      {...props}
    />
  );
}

type DataCardProps = Omit<SurfaceCardProps, "children"> & {
  children?: ReactNode;
  description?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}

function DataCard({
  children,
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
  value,
  wide = false,
}: {
  className?: string;
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("space-y-1", wide && "sm:col-span-2", className)}>
      <dt className={cn(textStyles({ variant: "fieldLabel" }), "font-bold")}>{label}</dt>
      <dd className={cn("whitespace-pre-wrap break-words", textStyles({ variant: "fieldValue" }))}>
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
