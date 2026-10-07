import { detectBannedTerms, type BannedTerm } from "@/lib/i18n/banned-terms";
import type { TrailDraft } from "./types";

export const MARKER = /\s*\[\^([^\]]+)\]/g;
export function stripMarkers(text: string): string {
  return text.replace(MARKER, "").trim();
}

/** Every reader-facing string of the trail, citation markers removed. */
function trailProse(trail: TrailDraft): string[] {
  return [
    trail.title,
    trail.description,
    trail.readerSituation,
    trail.promise,
    trail.intro,
    ...trail.sections.flatMap((section) => [
      section.title,
      section.body,
      ...section.picks.map((pick) => pick.note),
    ]),
    trail.closing,
    trail.exclusions,
  ].map(stripMarkers);
}

export type ZhCheck = {
  /** Han characters as a share of Han plus Latin letters, URLs ignored. */
  hanShare: number;
  bannedTerms: BannedTerm[];
  pass: boolean;
};

/**
 * Report-only zh-TW check for the reviewer: script share and mainland
 * vocabulary. It never rewrites the draft and never blocks delivery.
 */
export function checkZhTw(trail: TrailDraft): ZhCheck {
  const prose = trailProse(trail);
  const letters = prose.join("\n").replace(/https?:\/\/\S+/g, "");
  const han = letters.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = letters.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const hanShare = han + latin ? han / (han + latin) : 0;
  const bannedTerms = [
    ...new Map(
      prose
        .flatMap(detectBannedTerms)
        .map(({ term, replacement }): [string, BannedTerm] => [
          term,
          { term, replacement },
        ]),
    ).values(),
  ];
  return {
    hanShare,
    bannedTerms,
    pass: hanShare >= 0.7 && bannedTerms.length === 0,
  };
}
