import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createTestClient, describeWithDb } from "@/test/setup";
import { verifyMitByCert } from "../mit-verification";

const supabase = () => createTestClient();
const brandIds: string[] = [];
const certNumbers: string[] = [];

afterEach(async () => {
  const client = supabase();
  if (certNumbers.length > 0) {
    await client.from("mit_registry").delete().in("cert_number", certNumbers);
    certNumbers.length = 0;
  }
  if (brandIds.length > 0) {
    await client.from("brands").delete().in("id", brandIds);
    brandIds.length = 0;
  }
});

describeWithDb("MIT certificate verification identity guards", () => {
  it("rejects a valid certificate registered to a different brand", async () => {
    const suffix = randomUUID();
    const brandId = await seedBrand(`María García Ceramics ${suffix}`);
    const certNumber = await seedRegistry(
      `MIT-${suffix}`,
      "另一家工坊有限公司",
      "另一家工坊",
    );

    await expect(verifyMitByCert(brandId, certNumber)).resolves.toEqual({
      error: "cert_mismatch",
    });

    const { data, error } = await supabase()
      .from("brands")
      .select("mit_status, mit_evidence")
      .eq("id", brandId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      mit_status: "unverified",
      mit_evidence: null,
    });
  });

  it("rejects a certificate already attached to another brand", async () => {
    const suffix = randomUUID();
    const targetBrandId = await seedBrand(`暖木家居 ${suffix}`);
    await seedBrand(`另一個家居品牌 ${suffix}`, {
      mit_status: "verified",
      mit_evidence: {
        mit_smile_cert: `MIT-${suffix}`,
        mit_smile_listed: true,
        verified_source: "integration-test",
      },
    });
    const certNumber = await seedRegistry(
      `MIT-${suffix}`,
      "暖木家居",
      "暖木家居",
    );

    await expect(verifyMitByCert(targetBrandId, certNumber)).resolves.toEqual({
      error: "cert_already_claimed",
    });

    const { data, error } = await supabase()
      .from("brands")
      .select("mit_status, mit_evidence")
      .eq("id", targetBrandId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      mit_status: "unverified",
      mit_evidence: null,
    });
  });

  it("accepts a registry company name after normalizing its legal suffix", async () => {
    const suffix = randomUUID();
    const brandId = await seedBrand(`暖木家居 ${suffix}`);
    const certNumber = await seedRegistry(
      `MIT-${suffix}`,
      `暖木家居 ${suffix} 有限公司`,
      null,
    );

    const result = await verifyMitByCert(brandId, certNumber);
    expect(result.error).toBeUndefined();

    const { data, error } = await supabase()
      .from("brands")
      .select("mit_status, mit_evidence")
      .eq("id", brandId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      mit_status: "verified",
      mit_evidence: {
        mit_smile_cert: certNumber,
        verified_source: "mit_registry_auto",
      },
    });
  });
});

async function seedBrand(
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  brandIds.push(id);
  const { error } = await supabase()
    .from("brands")
    .insert({
      id,
      name,
      slug: `integration-${id}`,
      status: "approved",
      product_type: "crafts",
      description: "Handmade goods created by a Taiwan-based studio.",
      mit_status: "unverified",
      ...overrides,
    });
  if (error) throw error;
  return id;
}

async function seedRegistry(
  certNumber: string,
  companyName: string,
  brandName: string | null,
): Promise<string> {
  certNumbers.push(certNumber);
  const { error } = await supabase().from("mit_registry").insert({
    cert_number: certNumber,
    company_name: companyName,
    brand_name: brandName,
    valid_until: null,
  });
  if (error) throw error;
  return certNumber;
}
