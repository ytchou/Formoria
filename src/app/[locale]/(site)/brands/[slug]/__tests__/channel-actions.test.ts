import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import {
  confirmChannelAction,
  getChannelViewerStateAction,
  ownerModerateChannelAction,
  submitChannelInfoAction,
} from "../actions";

const { claimUser } = vi.hoisted(() => ({
  claimUser: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@example.test",
  },
}));

vi.mock("@/lib/auth/claim-user", () => ({
  requireClaimUser: async () => claimUser,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

let auditWrites: AuditRecord[];

describe("brand detail actions — locations section kill switch", () => {
  beforeEach(() => {
    auditWrites = [];
    setAuditWriteSeam(async (record) => {
      auditWrites.push(record);
      return null;
    });
  });

  afterEach(() => {
    resetAuditEmitterForTests();
  });

  it("rejects submitChannelInfoAction while the section is disabled", async () => {
    const formData = new FormData();
    formData.set("brandId", "00000000-0000-4000-8000-0000000000ff");
    formData.set("brandSlug", "missing-brand");
    formData.set("name", "Disabled channel");
    formData.set("channelType", "offline");

    expect(await submitChannelInfoAction({}, formData)).toEqual({
      error: "unknown",
    });
    expect(auditWrites).toEqual([]);
  });

  it("rejects confirmChannelAction while the section is disabled", async () => {
    expect(
      await confirmChannelAction(
        "00000000-0000-4000-8000-0000000000ff",
        "missing-brand",
      ),
    ).toEqual({ error: "unknown" });
    expect(auditWrites).toEqual([]);
  });

  it("rejects ownerModerateChannelAction while the section is disabled", async () => {
    expect(
      await ownerModerateChannelAction(
        "00000000-0000-4000-8000-0000000000ff",
        "missing-brand",
        "confirmed",
      ),
    ).toEqual({ error: "unknown" });
    expect(auditWrites).toEqual([]);
  });

  it("getChannelViewerStateAction returns an empty viewer state while disabled", async () => {
    await expect(getChannelViewerStateAction("not-a-uuid")).resolves.toEqual({
      isOwner: false,
      confirmedChannelIds: [],
    });
  });
});
