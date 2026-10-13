import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { test, expect } from "../fixtures/auth";
import { validateStagingTarget } from "../../src/lib/supabase/project-target";
import { BRAND_SUBMISSIONS_BUCKET } from "../../src/lib/images/storage-keys";

function stagingClient() {
  validateStagingTarget(process.env, {
    allowLocalApp: process.env.E2E_LOCAL_APP === "true",
  });
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

async function cleanupSubmission(
  db: ReturnType<typeof stagingClient>,
  id: string,
) {
  const objects = checked(
    await db.storage.from(BRAND_SUBMISSIONS_BUCKET).list(`submissions/${id}`),
  );
  const paths = (objects ?? []).map(
    (object) => `submissions/${id}/${object.name}`,
  );
  if (paths.length)
    checked(await db.storage.from(BRAND_SUBMISSIONS_BUCKET).remove(paths));
  checked(await db.from("submission_images").delete().eq("submission_id", id));
  checked(await db.from("brand_submissions").delete().eq("id", id));
  expect(
    checked(
      await db.from("submission_images").select("id").eq("submission_id", id),
    ),
  ).toEqual([]);
  expect(
    checked(await db.from("brand_submissions").select("id").eq("id", id)),
  ).toEqual([]);
  expect(
    checked(
      await db.storage.from(BRAND_SUBMISSIONS_BUCKET).list(`submissions/${id}`),
    ),
  ).toEqual([]);
}

test.describe("Admin review reliability", () => {
  // Catches the silent 1,000-row ceiling hiding older reviewable products.
  test("an editor can find a product beyond the first thousand catalog rows", async ({
    adminPage,
  }) => {
    const db = stagingClient();
    const data = checked(
      await db
        .from("curated_products")
        .select("id, name_zh, subcategory, visible")
        .eq("visible", true)
        .not("subcategory", "is", null)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(1000, 1000),
    );
    const product = data?.at(0);
    test.skip(
      !product,
      "This regression requires the staging catalog to exceed 1,000 products",
    );
    await adminPage.goto("/admin/curated-products?stage=visible");
    await adminPage
      .getByRole("textbox", { name: "Search", exact: true })
      .fill(product!.name_zh);
    await expect(
      adminPage.getByRole("row").filter({ hasText: product!.name_zh }).first(),
    ).toBeVisible();
  });

  // Catches spreadsheet execution of subscriber-controlled names in real exports.
  test("an editor downloads subscriber formulas as text", async ({
    adminPage,
  }) => {
    const db = stagingClient();
    const id = randomUUID();
    const email = `e2e-csv-${id}@example.invalid`;
    try {
      checked(
        await db.from("newsletter_subscribers").insert({
          id,
          email,
          name: "=1+1",
          interests: ["curated-picks"],
          locale: "en",
          consent_source: "homepage_newsletter",
          consent_version: "2026-07-16",
          consent_recorded_at: new Date().toISOString(),
        }),
      );
      const response = await adminPage.request.get(
        `/admin/newsletter/export?q=${encodeURIComponent(email)}`,
      );
      expect(response.status()).toBe(200);
      const csv = await response.text();
      expect(csv).toContain(`${email},"\t=1+1",pending,curated-picks,en,`);
      expect(csv).not.toContain("confirm_token");
    } finally {
      checked(await db.from("newsletter_subscribers").delete().eq("id", id));
      expect(
        checked(
          await db.from("newsletter_subscribers").select("id").eq("id", id),
        ),
      ).toEqual([]);
    }
  });

  // Catches ordinary rejected photos returning generic 500s in both admin flows.
  test("an editor receives actionable errors for undersized and unsupported images", async ({
    adminPage,
  }) => {
    stagingClient();
    const id = randomUUID();
    const tiny = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#446688" },
    })
      .png()
      .toBuffer();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#446688"/></svg>',
    );
    for (const kind of ["brands", "submissions"]) {
      for (const file of [
        {
          name: "tiny.png",
          mimeType: "image/png",
          buffer: tiny,
          message: /minimum 200×200/,
        },
        {
          name: "unsupported.svg",
          mimeType: "image/svg+xml",
          buffer: svg,
          message: /allowed formats: jpeg, png, webp/,
        },
      ]) {
        const { message, ...upload } = file;
        const response = await adminPage.request.post(
          `/api/admin/${kind}/${id}/images`,
          { multipart: { file: upload } },
        );
        expect(response.status()).toBe(400);
        expect((await response.json()).error).toMatch(message);
      }
    }
  });

  // Catches upload staging that commits an unreadable preview or loses its image row.
  test("an editor stages one readable submission image", async ({
    adminPage,
  }) => {
    const db = stagingClient();
    const id = randomUUID();
    try {
      checked(
        await db.from("brand_submissions").insert({
          id,
          brand_name: `[E2E-TEST] Admin image ${id}`,
          submitter_email: `e2e-image-${id}@example.invalid`,
          brand_id: null,
          status: "pending",
          intent: "recommend",
          is_brand_owner: false,
        }),
      );
      const bytes = await sharp({
        create: { width: 300, height: 300, channels: 3, background: "#446688" },
      })
        .png()
        .toBuffer();
      const response = await adminPage.request.post(
        `/api/admin/submissions/${id}/images`,
        {
          multipart: {
            file: {
              name: "studio-photo.png",
              mimeType: "image/png",
              buffer: bytes,
            },
          },
        },
      );
      expect(response.status()).toBe(201);
      const image = await response.json();
      const storagePath = image.storagePath;
      expect(storagePath).toMatch(new RegExp(`^submissions/${id}/`));
      expect((await adminPage.request.get(image.url)).status()).toBe(200);
      const rows = checked(
        await db
          .from("submission_images")
          .select("id, storage_path")
          .eq("submission_id", id),
      );
      expect(rows).toEqual([{ id: image.id, storage_path: storagePath }]);
    } finally {
      await cleanupSubmission(db, id);
    }
  });
});
