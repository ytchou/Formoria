import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { textStyles } from "./text-styles";

/**
 * THE ONLY TRUST LABEL THAT MAY RENDER AS A BADGE.
 *
 * Design decision D11: directory membership is vocabulary, never a badge —
 * every brand in the directory has it, so a badge on one carries no
 * information. The brand-supplied marker is a credit line rendered beside the
 * asset it credits, not a badge either. Sponsorship is structurally separate
 * content, labelled where it sits.
 *
 * That leaves exactly one badge, and this component is it. The union below is
 * closed on purpose: before this component existed the label was a bare
 * `<Badge variant="secondary">` reached from three call sites, and the strings
 * had already drifted apart between them. A second member here reopens that
 * door, so adding one is a design change, not a code change.
 */
export const TRUST_LABELS = ["selected"] as const;

export type TrustLabelKind = (typeof TRUST_LABELS)[number];

type TrustLabelProps = {
  className?: string;
  /** The only accepted value is `"selected"`. See `TRUST_LABELS`. */
  kind?: TrustLabelKind;
};

/**
 * A static label. Not a link, not a button, not a focus stop — it states a
 * commitment, it does not offer an action. The accent is reserved for
 * interaction, so this wears a rule outline and interface type instead.
 */
function TrustLabel({ className, kind = "selected" }: TrustLabelProps) {
  const t = useTranslations("trustLabel");

  // A kind smuggled past the compiler renders nothing rather than silently
  // falling back to the one real label or leaking a raw catalogue key.
  if (!TRUST_LABELS.includes(kind)) return null;

  return (
    <span
      data-slot="trust-label"
      data-trust-label={kind}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center rounded-[2px] border border-rule bg-transparent px-2 whitespace-nowrap",
        textStyles({ variant: "micro" }),
        className,
      )}
    >
      {t(kind)}
    </span>
  );
}

export { TrustLabel };
