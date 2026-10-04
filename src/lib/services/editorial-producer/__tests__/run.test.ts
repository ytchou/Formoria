import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../../curated-products-catalog";
import { RunStore } from "../store";
import { LIMITS } from "../types";
import { deriveClaims, runProducer } from "../run";
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
    mismatchedQuote?: boolean;
    mixedSupport?: boolean;
    catalogQuestion?: boolean;
    serverErrorOnce?: boolean;
    styleNote?: boolean;
    corruptCatalogId?: boolean;
    blockUnchanged?: boolean;
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
    if (options.serverErrorOnce && tasks.length === 1)
      return new Response(JSON.stringify({ error: { message: "upstream" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    const context = JSON.parse(
      request.messages.at(1)?.content ?? "{}",
    ).untrustedData;
    const sourceId = context.sources?.at(0)?.id ?? "";
    const productAlias = context.products?.at(0)?.id ?? "";
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
            productId: productAlias,
            reason: "桌燈可作為閱讀角落的提案，尺寸仍待查證",
          },
          ...(options.corruptCatalogId
            ? [{ productId: "p99", reason: "A copied ID the model mangled" }]
            : []),
        ],
        exclusions: [],
        question: options.catalogQuestion
          ? "若官方頁面確認後商品不足，是否接受收窄角度？"
          : null,
      },
      research: {
        products: [
          {
            productId: productAlias,
            sourceId,
            identityConfirmed: true,
            identityExcerpt: "河岸木作 楓木桌燈",
            facts: [
              {
                claim: "燈座以楓木製作。",
                excerpt: options.mismatchedQuote
                  ? "燈座以實木製作。"
                  : "燈座以楓木製作。",
              },
              ...(options.mixedSupport
                ? [{ claim: "燈座可防水。", excerpt: "燈座以楓木製作。" }]
                : []),
            ],
            exclusionReason: null,
          },
        ],
        question: null,
      },
      "facts-review": {
        supportedFactIds: options.rejectFacts ? [] : ["f1"],
        failures: options.rejectFacts
          ? ["The material is not supported for this variant"]
          : options.mixedSupport
            ? ["f2: the source does not establish water resistance"]
            : [],
      },
      outline: {
        outline: "閱讀桌面上的聖誕提案，說明材料與前往品牌的路徑",
        question: null,
      },
      draft: {
        markdown:
          "# 留一盞燈給閱讀的角落\n\n燈座以楓木製作。[^f1]\n\n若桌面留得下，可以把這件桌燈列為禮物提案。",
        openDecisions: ["Human final selection"],
      },
      "draft-review": {
        issues: [
          ...(options.rejectDraft
            ? [
                {
                  severity: "blocking",
                  quote: "",
                  problem: "Article claims an unsupported dimension",
                  falseBelief: "The lamp has a verified size",
                },
              ]
            : []),
          ...(options.blockUnchanged
            ? [
                tasks.filter((name) => name === "draft-review").length === 1
                  ? {
                      severity: "blocking",
                      quote: "",
                      problem: "Opening scene is missing",
                      falseBelief: "The article answers the brief",
                    }
                  : {
                      severity: "blocking",
                      quote: "燈座以楓木製作。",
                      problem: "Material needs a variant qualifier",
                      falseBelief: "Every variant is maple",
                    },
              ]
            : []),
          ...(options.styleNote
            ? [
                {
                  severity: "revise",
                  quote: "留一盞燈給閱讀的角落",
                  problem: "Title could name the recipient",
                  falseBelief: "",
                },
              ]
            : []),
        ],
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
  expect(result.rejectedFacts?.at(0)?.reason).toBe(
    "Independent review found it unsupported",
  );
});
it("stops after its bounded revisions and preserves the partial draft", async () => {
  const { store, id } = await fixture();
  provider({ rejectDraft: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("blocked");
  expect(result.budget.revisions).toBe(LIMITS.revisions);
  expect(result.draft).toContain("閱讀");
  expect(result.review?.failures).toEqual([
    "Article claims an unsupported dimension (reader would believe: The lamp has a verified size)",
  ]);
});
it("retains reviewed facts when a different claim is rejected", async () => {
  const { store, id } = await fixture();
  provider({ mixedSupport: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.facts.map((fact) => fact.claim)).toEqual(["燈座以楓木製作。"]);
  expect(result.rejectedFacts).toContainEqual({
    productId: product.id,
    claim: "燈座可防水。",
    reason: "Independent review found it unsupported",
  });
  expect(result.draft).not.toContain("防水");
});
it("excludes a nonliteral evidence quote instead of trapping the run at research", async () => {
  const { store, id } = await fixture();
  provider({ mismatchedQuote: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("blocked");
  expect(result.facts).toHaveLength(0);
  expect(result.draft).toBeUndefined();
  expect(result.rejectedFacts).toContainEqual({
    productId: product.id,
    claim: "燈座以楓木製作。",
    reason: "Evidence excerpt does not occur in its source",
  });
  expect(
    await readFile(join(store.root, id, "research-extraction.json"), "utf8"),
  ).toContain("燈座以實木製作。");
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
it("records a hypothetical catalog question as an open decision instead of pausing", async () => {
  const { store, id } = await fixture();
  provider({ catalogQuestion: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.answers).toHaveLength(0);
  expect(result.review?.openDecisions).toContain(
    "若官方頁面確認後商品不足，是否接受收窄角度？",
  );
});
it("charges a failed model attempt at its reservation and keeps working", async () => {
  const { store, id } = await fixture();
  const tasks = provider({ serverErrorOnce: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.budget.costUncertain).toBe(false);
  expect(result.budget.reservedUsd).toBe(0);
  expect(result.budget.modelAttempts).toBe(tasks.length);
});
it("charges an unsettled reservation left by a killed process before resuming", async () => {
  const { store, id } = await fixture();
  provider();
  await store.update(id, (run) => {
    run.budget.reservedUsd = 0.05;
  });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.budget.costUsd).toBeGreaterThan(0.05);
  expect(result.budget.reservedUsd).toBe(0);
});
it("derives the claim ledger from cited sentences, keeping trailing markers with their sentence", () => {
  expect(
    deriveClaims(
      "# 標題\n\n燈座以楓木製作。[^f1][^f2] 若桌面留得下，可以列為提案。\n\n燈罩可拆[^f3]，方便收納！",
    ),
  ).toEqual([
    { text: "燈座以楓木製作。", factIds: ["f1", "f2"] },
    { text: "燈罩可拆，方便收納！", factIds: ["f3"] },
  ]);
});
it("delivers non-misleading review notes to the editor without blocking or revising", async () => {
  const { store, id } = await fixture();
  const tasks = provider({ styleNote: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.budget.revisions).toBe(0);
  expect(tasks.filter((task) => task === "draft")).toHaveLength(1);
  expect(result.review?.notes).toEqual([
    "「留一盞燈給閱讀的角落」: Title could name the recipient",
  ]);
});
it("drops a catalog ID the model mangled instead of halting the run", async () => {
  const { root, store, id } = await fixture();
  provider({ corruptCatalogId: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.candidates?.map((item) => item.productId)).toEqual([
    product.id,
  ]);
  expect(await readFile(join(root, id, "audit.jsonl"), "utf8")).toContain(
    "droppedUnknownProductIds",
  );
});
it("does not let a re-review block a sentence that already passed and did not change", async () => {
  const { store, id } = await fixture();
  const tasks = provider({ blockUnchanged: true });
  const result = await runProducer(store, id);
  expect(result.status, result.error).toBe("ready_for_review");
  expect(result.budget.revisions).toBe(1);
  expect(tasks.filter((task) => task === "draft-review")).toHaveLength(2);
  expect(result.review?.notes?.at(0)).toContain(
    "Material needs a variant qualifier",
  );
});
