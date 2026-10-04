import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../../curated-products-catalog";
import { RunStore } from "../store";
import { runProducer } from "../run";
import { ProducerController } from "../controller";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const product: CatalogProduct = {
  id: "luminaire-maple-desk",
  key: "maple-desk-lamp",
  nameZh: "楓木桌燈",
  nameEn: "Maple desk lamp",
  brandSlug: "river-woodwork",
  brandName: "河岸木作",
  category: "home-living",
  subcategory: "lighting",
  material: ["wood"],
  createdAt: "2026-09-01T00:00:00Z",
  imageUrl: null,
  officialUrl: "https://river-woodwork.example/products/maple-desk",
  productDescriptionZh: "小桌面的閱讀燈",
  productDescriptionEn: null,
  brand: {
    slug: "river-woodwork",
    purchaseWebsite: "https://river-woodwork.example",
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
  },
};
async function fixture() {
  vi.stubEnv("OPENAI_API_KEY", "fixture-provider-token");
  const root = await mkdtemp(join(tmpdir(), "editorial-journey-"));
  roots.push(root);
  const store = new RunStore(root);
  await store.initialize();
  const { run } = await store.start({
    operatorSlackId: "U_MARIA_GARCIA",
    channelId: "C_FORMORIA_EDITORIAL",
    threadTs: "1791043200.000100",
    requestId: "maria-christmas-small-apartment",
    brief: "聖誕節送給小宅屋主的禮物，重點是閱讀角落",
  });
  await store.update(run.id, (current) => {
    current.catalog = [product];
    current.content = [];
    current.price = {
      model: "gpt-5.6-luna",
      input_per_m: 0.2,
      cached_input_per_m: 0.02,
      output_per_m: 1.2,
      effective_from: "2026-01-01T00:00:00Z",
    };
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { root, store, id: run.id };
}
function provider(
  options: {
    overlap?: boolean;
    rejectFacts?: boolean;
    rejectDraft?: boolean;
    unknownUsage?: boolean;
    failedSource?: boolean;
  } = {},
) {
  const tasks: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === product.officialUrl)
      return new Response(
        options.failedSource
          ? "<main>Product page unavailable</main>"
          : "<main><h1>河岸木作 楓木桌燈</h1><p>燈座以楓木製作。</p></main>",
        {
          status: options.failedSource ? 404 : 200,
          headers: { "content-type": "text/html" },
        },
      );
    if (!String(input).includes("/chat/completions"))
      throw new Error("Unexpected external call: " + String(input));
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: string }>;
    };
    const task =
      /Task: ([a-z-]+)/.exec(request.messages.at(0)?.content ?? "")?.[1] ?? "";
    tasks.push(task);
    const context = JSON.parse(
      request.messages.at(1)?.content ?? "{}",
    ).untrustedData;
    const sourceId = context.sources?.at(0)?.id ?? "";
    const outputs: Record<string, unknown> = {
      brief: {
        topic: "小宅聖誕禮物",
        audience: "小宅屋主",
        intent: "閱讀角落禮物提案",
        angle: "桌面上的一盞燈",
        requirements: ["閱讀角落"],
        question: null,
      },
      overlap:
        options.overlap && !context.answers?.length
          ? {
              overlaps: [],
              decisionNeeded: true,
              question: "維護既有提案，還是採用獨立閱讀角度？",
            }
          : { overlaps: [], decisionNeeded: false, question: null },
      catalog: {
        candidates: [
          {
            productId: product.id,
            reason: "桌燈可作為閱讀角落的提案，尺寸仍待查證",
          },
        ],
        exclusions: [],
        question: null,
      },
      research: {
        products: [
          {
            productId: product.id,
            sourceId,
            identityConfirmed: true,
            identityExcerpt: "河岸木作 楓木桌燈",
            facts: [{ claim: "燈座以楓木製作。", excerpt: "燈座以楓木製作。" }],
            exclusionReason: null,
          },
        ],
        question: null,
      },
      "facts-review": {
        supportedFactIds: options.rejectFacts ? [] : ["f1"],
        failures: options.rejectFacts
          ? ["The material is not supported for this variant"]
          : [],
      },
      outline: {
        outline: "閱讀桌面上的聖誕提案，說明材料與前往品牌的路徑",
        question: null,
      },
      draft: {
        markdown:
          "# 留一盞燈給閱讀的角落\n\n燈座以楓木製作。[^f1]\n\n若桌面留得下，可以把這件桌燈列為禮物提案。",
        claims: [{ text: "燈座以楓木製作。", factIds: ["f1"] }],
        openDecisions: ["Human final selection"],
      },
      "draft-review": {
        failures: options.rejectDraft
          ? ["Article claims an unsupported dimension"]
          : [],
        openDecisions: ["Human final selection"],
      },
    };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(outputs[task]) },
            finish_reason: "stop",
          },
        ],
        ...(options.unknownUsage
          ? {}
          : { usage: { prompt_tokens: 200, completion_tokens: 100 } }),
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  return tasks;
}

it("takes a saved catalog through official evidence to a reviewed zh-TW draft and durable payload journal", async () => {
  const { root, store, id } = await fixture();
  const tasks = provider();
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.draft).toContain("燈座以楓木製作。[^f1]");
  expect(result.facts.at(0)?.excerpt).toBe("燈座以楓木製作。");
  expect(result.sources.at(0)?.finalUrl).toBe(product.officialUrl);
  expect(result.budget.modelAttempts).toBe(tasks.length);
  expect(result.budget.costUsd).toBeGreaterThan(0);
  expect(result.budget.reservedUsd).toBe(0);
  const journal = await readFile(join(root, id, "audit.jsonl"), "utf8");
  expect(journal).toContain("chat_completions");
  expect(journal).toContain("prompt_tokens");
  expect(journal).toContain("燈座以楓木製作。");
  const draftRequest = journal
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((event) =>
      event.request?.messages?.at(0)?.content?.includes("Task: draft\n"),
    )?.request;
  expect(draftRequest.messages.at(0).content).toContain(
    "Write the full natural zh-TW Markdown article",
  );
  const draftData = JSON.parse(
    draftRequest.messages.at(1).content,
  ).untrustedData;
  expect(draftData).not.toHaveProperty("instruction");
  expect(draftData.facts.at(0).excerpt).toBe("燈座以楓木製作。");
});
it("pauses on an editorial fork and resumes from the saved stage without resetting spending", async () => {
  const { store, id } = await fixture();
  const tasks = provider({ overlap: true });
  const waiting = await runProducer(store, id);
  expect(waiting.status, waiting.error).toBe("awaiting_input");
  expect(waiting.stage).toBe("overlap");
  const question = waiting.question!;
  const controller = new ProducerController(store);
  try {
    await controller.command({
      runId: id,
      operatorSlackId: waiting.operatorSlackId,
      channelId: waiting.channelId,
      threadTs: waiting.threadTs,
      command: "answer",
      answer: "採用獨立閱讀角度",
      eventId: "maria-angle-answer",
    });
    await vi.waitFor(async () =>
      expect((await store.read(id)).status).toBe("ready_for_review"),
    );
  } finally {
    await controller.shutdown();
  }
  const complete = await store.read(id);
  expect(complete.status).toBe("ready_for_review");
  expect(complete.budget.costUsd).toBeGreaterThan(waiting.budget.costUsd);
  expect(tasks.filter((task) => task === "brief")).toHaveLength(1);
  expect(complete.answers.at(-1)?.questionText).toBe(question.text);
});
it("blocks unsupported variant facts before producing a misleading article", async () => {
  const { store, id } = await fixture();
  provider({ rejectFacts: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("blocked");
  expect(result.draft).toBeUndefined();
  expect(result.facts).toHaveLength(0);
  expect(result.exclusions.at(0)?.reason).toContain("Unsupported fact");
});
it("stops after two failed revisions and preserves the partial draft", async () => {
  const { store, id } = await fixture();
  provider({ rejectDraft: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("blocked");
  expect(result.budget.revisions).toBe(2);
  expect(result.draft).toContain("閱讀");
  expect(result.review?.failures).toContain(
    "Article claims an unsupported dimension",
  );
});
it("does not spend again when a paid response omits usage", async () => {
  const { store, id } = await fixture();
  const tasks = provider({ unknownUsage: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("budget_exhausted");
  expect(result.budget.costUncertain).toBe(true);
  expect(result.budget.reservedUsd).toBeGreaterThan(0);
  expect(tasks).toHaveLength(1);
});
it("stops further spending when the paid response cannot be durably recorded", async () => {
  const { root, store, id } = await fixture();
  const tasks = provider();
  const respond = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    if (String(input).includes("/chat/completions")) {
      const journal = join(root, id, "audit.jsonl");
      await rename(journal, journal + ".saved");
      await mkdir(journal);
    }
    return respond(input, init);
  });
  const result = await runProducer(store, id);
  expect(result.status).toBe("budget_exhausted");
  expect(result.budget.costUncertain).toBe(true);
  expect(result.budget.reservedUsd).toBeGreaterThan(0);
  expect(result.budget.modelAttempts).toBe(1);
  expect(tasks).toHaveLength(1);
});
it("preserves source failures as exclusions instead of drafting from catalog descriptions", async () => {
  const { store, id } = await fixture();
  provider({ failedSource: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("blocked");
  expect(result.draft).toBeUndefined();
  expect(result.sources).toHaveLength(0);
  expect(result.facts).toHaveLength(0);
  expect(result.budget.fetchAttempts).toBe(2);
  expect(result.exclusions).toContainEqual({
    productId: product.id,
    reason: "Official source unavailable; no facts inferred from catalog copy",
  });
});
