import { cn } from "@/lib/utils";
import { CONTROL_ICON, FOCUS_RING } from "./control-surface";
import { textStyles } from "./text-styles";

type ActionLinkStyleProps = {
  className?: string;
};

/** Compact public-editorial navigation; callers own placement and spacing. */
export function actionLinkStyles({
  className,
}: ActionLinkStyleProps = {}): string {
  return cn(
    "inline-flex min-h-11 min-w-11 items-center gap-1 rounded-control",
    textStyles({ variant: "link" }),
    FOCUS_RING,
    CONTROL_ICON,
    className,
  );
}
