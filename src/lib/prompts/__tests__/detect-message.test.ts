import { describe, expect, it } from "vitest";
import { DETECT_MESSAGE_LABELS } from "../detect-message";
import { JEV_INPUT_LABELS } from "../jev";

describe("DETECT_MESSAGE_LABELS", () => {
  it("jev_labels_reuse_detect_labels", () => {
    expect(JEV_INPUT_LABELS.brandSlug).toBe(DETECT_MESSAGE_LABELS.brandSlug);
    expect(JEV_INPUT_LABELS.brandName).toBe(DETECT_MESSAGE_LABELS.brandName);
    expect(JEV_INPUT_LABELS.description).toBe(DETECT_MESSAGE_LABELS.description);
    expect(JEV_INPUT_LABELS.website).toBe(DETECT_MESSAGE_LABELS.website);
    expect(JEV_INPUT_LABELS.probe).toBe(DETECT_MESSAGE_LABELS.probe);
    expect(JEV_INPUT_LABELS.searchResult).toBe(
      DETECT_MESSAGE_LABELS.searchResult,
    );
    expect(JEV_INPUT_LABELS.submittedWebsite).toBe(
      DETECT_MESSAGE_LABELS.submittedWebsite,
    );
    expect(JEV_INPUT_LABELS.missingValue).toBe(DETECT_MESSAGE_LABELS.missing);
  });

  it("labels_are_unique", () => {
    // A duplicate field label would make parseLabelledLines ambiguous.
    const fieldLabels = [
      DETECT_MESSAGE_LABELS.brandSlug,
      DETECT_MESSAGE_LABELS.brandName,
      DETECT_MESSAGE_LABELS.description,
      DETECT_MESSAGE_LABELS.website,
      DETECT_MESSAGE_LABELS.submittedWebsite,
      DETECT_MESSAGE_LABELS.searchResult,
      DETECT_MESSAGE_LABELS.probe,
    ];
    expect(new Set(fieldLabels).size).toBe(fieldLabels.length);

    const all = Object.values(DETECT_MESSAGE_LABELS);
    expect(new Set(all).size).toBe(all.length);
  });
});
