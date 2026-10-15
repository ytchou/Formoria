import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** The 台灣製造 badge over a tile's photo; null unless the product qualifies. */
export function OriginBadge({
  mitQualified,
  label,
}: {
  mitQualified: boolean;
  label?: string;
}) {
  if (!mitQualified || !label) return null;
  return (
    <Badge
      variant="verified"
      className="absolute top-3 left-3 z-20"
      aria-label={label}
    >
      <ShieldCheck aria-hidden />
      {label}
    </Badge>
  );
}
