import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { textStyles } from "./text-styles";

const badgeVariants = cva(
  cn(
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 whitespace-nowrap transition-[background-color,border-color,color,box-shadow] focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-danger aria-invalid:ring-danger/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
    textStyles({ variant: "micro" }),
  ),
  {
    variants: {
      variant: {
        default: "bg-accent text-ground [a]:hover:bg-accent/80",
        secondary:
          "bg-surface text-ink-soft [a]:hover:bg-surface/80",
        destructive:
          "bg-danger/10 text-danger focus-visible:ring-danger/20 [a]:hover:bg-danger/20",
        outline:
          "border-rule text-ink [a]:hover:bg-surface [a]:hover:text-ink-muted",
        ghost:
          "hover:bg-surface hover:text-ink-muted",
        link: "text-accent underline-offset-4 hover:underline",
        success: "bg-verified-green-bg text-verified-green",
        verified: "bg-mit-verified-bg text-mit-verified",
        declared: "border-rule bg-surface text-ink-muted",
        warning: "bg-warning/10 text-warning [a]:hover:bg-warning/20",
        // For a badge sitting ON a filled banner: the ground becomes the
        // chip and the banner's own colour becomes the text.
        inverse: "bg-ground text-mit-verified",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge };
