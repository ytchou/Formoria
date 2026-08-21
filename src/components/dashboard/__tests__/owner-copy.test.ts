import { describe, expect, it } from "vitest";

import en from "../../../../messages/en.json";
import zhTW from "../../../../messages/zh-TW.json";

/**
 * Three sentences the owner surfaces did not say before this ticket.
 *
 * They are pinned here rather than left to `message-parity.test.ts` because
 * parity only proves the two catalogues have the same KEYS. Each of these
 * strings exists to close a specific misreading, and a key that survives with
 * its meaning quietly edited away closes nothing:
 *
 *  1. The privacy boundary. "Outbound clicks" is the number that invites an
 *     owner to assume Formoria watches what happens after the click. It does
 *     not, and the page has to say so where that number is explained.
 *  2. What 審核 does. `save` and `wizardPublish` were bare verbs; publishing
 *     queues a review, and an owner who does not know that reads the delay as
 *     a bug.
 *  3. That 選物 is not owner-editable. Already true — every curated-product
 *     write path is admin-only — but never stated, so an owner goes looking
 *     for a control that does not exist.
 */
const PRIVACY_BOUNDARY_ZH = "Formoria 不追蹤你在品牌官網上的行為";

describe("owner-facing copy that this ticket introduces", () => {
  it("states the privacy boundary on owner analytics, in both locales", () => {
    expect(zhTW.dashboard.analytics.privacyBoundary).toContain(
      PRIVACY_BOUNDARY_ZH,
    );
    expect(en.dashboard.analytics.privacyBoundary).toMatch(
      /does not track/i,
    );
  });

  it("explains what happens after publish, in both locales", () => {
    expect(zhTW.dashboard.edit.reviewNotice).toContain("審核");
    expect(en.dashboard.edit.reviewNotice).toMatch(/review/i);
  });

  it("states that 選物 is not owner-editable, in both locales", () => {
    expect(zhTW.dashboard.edit.curationNotice).toContain("選物");
    expect(en.dashboard.edit.curationNotice).toContain("選物");
  });

  it("keeps the register at 你 and claims no ranking", () => {
    const zhCopy = [
      zhTW.dashboard.analytics.privacyBoundary,
      zhTW.dashboard.edit.reviewNotice,
      zhTW.dashboard.edit.curationNotice,
    ];

    for (const line of zhCopy) {
      // `docs/strategy/brand-voice.md`: the register is 你, never 您.
      expect(line).not.toContain("您");
      // No superlatives, no rankings — the vocabulary rules that apply to
      // every public sentence apply to owner-facing ones too.
      expect(line).not.toMatch(/最[好佳強大優]|第一|唯一|頂級/);
    }
  });
});
