// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import AdminError from "../error";
import messages from "../../../../messages/en.json";

/**
 * The v1 colour names. Every one of them still resolves — the shadcn palette
 * is live until the last surface leaves it — which is exactly why a boundary
 * can keep rendering "correctly" on the wrong system for a whole release. An
 * error page is also the surface nobody opens on purpose, so drift here is
 * found by a user, in the worst moment, or not at all.
 */
const RETIRED_COLOUR_TOKENS = [
  "bg-background",
  "bg-card",
  "bg-muted",
  "bg-secondary",
  "border-border",
  "divide-border",
  "text-foreground",
  "text-muted-foreground",
  "text-secondary-foreground",
  "text-card-foreground",
];

/**
 * The boundaries this chain owns. `brands/` and `discover/` boundaries are
 * excluded: they belong to a sibling chain in the same wave and editing them
 * from here would collide.
 */
const BOUNDARIES = [
  "src/app/global-error.tsx",
  "src/app/admin/error.tsx",
  "src/components/shared/route-error.tsx",
  "src/app/[locale]/(site)/error.tsx",
  "src/app/[locale]/(site)/not-found.tsx",
  "src/app/[locale]/(site)/(protected)/error.tsx",
  "src/app/[locale]/(site)/(protected)/dashboard/loading.tsx",
  "src/app/[locale]/(site)/(protected)/dashboard/analytics/loading.tsx",
  "src/app/[locale]/(site)/(protected)/favorites/loading.tsx",
  "src/app/[locale]/(site)/(protected)/settings/loading.tsx",
  "src/app/[locale]/(site)/events/[slug]/error.tsx",
  "src/app/[locale]/(site)/events/[slug]/not-found.tsx",
  "src/app/[locale]/(site)/stories/[slug]/error.tsx",
  "src/app/[locale]/(site)/stories/[slug]/not-found.tsx",
];

describe("error and loading boundaries", () => {
  it("renders the admin boundary with a recovery action that retries", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();

    // The boundary renders inside the admin layout, which mounts
    // NextIntlClientProvider — its copy comes from `admin.common`.
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdminError error={new Error("boom")} reset={reset} />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("carries no retired v1 colour token", () => {
    const offenders: string[] = [];

    for (const boundary of BOUNDARIES) {
      const source = readFileSync(join(process.cwd(), boundary), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        for (const token of RETIRED_COLOUR_TOKENS) {
          if (new RegExp(`\\b${token}\\b`).test(line)) {
            offenders.push(`${boundary}:${index + 1} — ${token}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
