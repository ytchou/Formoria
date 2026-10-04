import { randomUUID } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { resolveOpenAIModel } from "@/lib/constants/llm-models";
import { runWithAuditContext } from "@/lib/audit/context";
import { createAgentModel, extractJson } from "../enrich-phases/agents/runtime";
import { toStrictJsonSchema } from "../_shared/zod-schema";
import { createRenderProvider } from "../enrich-phases/scraper/render/provider";
import type { AttemptLifecycle } from "../openai-client";
import { getModelPrice } from "../llm-pricing";
import {
  assertBudget,
  BudgetStop,
  reserveModelCost,
  settleModelCost,
} from "./budget";
import { EDITORIAL_RULES } from "./prompts";
import { fetchSource, loadContext } from "./sources";
import { RunStore } from "./store";
import { LIMITS, type Fact, type Run, type Stage } from "./types";

const QuestionSchema = z.string().min(1).nullable();
const BriefSchema = z.object({
  topic: z.string().min(1),
  audience: z.string().min(1),
  intent: z.string().min(1),
  angle: z.string().min(1),
  requirements: z.array(z.string()),
  question: QuestionSchema,
});
const OverlapSchema = z.object({
  overlaps: z.array(z.object({ slug: z.string(), reason: z.string() })),
  decisionNeeded: z.boolean(),
  question: QuestionSchema,
});
const CatalogSchema = z.object({
  candidates: z
    .array(z.object({ productId: z.string(), reason: z.string().min(1) }))
    .max(LIMITS.sourcePages),
  exclusions: z.array(z.object({ productId: z.string(), reason: z.string() })),
  question: QuestionSchema,
});
const ResearchSchema = z.object({
  products: z.array(
    z.object({
      productId: z.string(),
      sourceId: z.string(),
      identityConfirmed: z.boolean(),
      identityExcerpt: z.string(),
      facts: z.array(
        z.object({ claim: z.string().min(1), excerpt: z.string().min(1) }),
      ),
      exclusionReason: z.string().nullable(),
    }),
  ),
  question: QuestionSchema,
});
const FactsReviewSchema = z.object({
  supportedFactIds: z.array(z.string()),
  failures: z.array(z.string()),
});
const OutlineSchema = z.object({
  outline: z.string().min(1),
  question: QuestionSchema,
});
const DraftSchema = z.object({
  markdown: z.string().min(1),
  claims: z.array(
    z.object({ text: z.string().min(1), factIds: z.array(z.string()).min(1) }),
  ),
  openDecisions: z.array(z.string()),
});
const ReviewSchema = z.object({
  failures: z.array(z.string()),
  openDecisions: z.array(z.string()),
});

export function validateDraft(
  run: Pick<Run, "draft" | "claims" | "facts">,
): string[] {
  const failures: string[] = [];
  const ids = new Set(run.facts.map((fact) => fact.id));
  const markdown = run.draft ?? "";
  if (!markdown.trim()) failures.push("Draft is empty");
  for (const match of markdown.matchAll(/\[\^([^\]]+)\]/g))
    if (!ids.has(match[1]!)) failures.push("Unknown citation: " + match[1]);
  for (const claim of run.claims) {
    if (!markdown.includes(claim.text))
      failures.push("Claim ledger does not match article: " + claim.text);
    if (
      !claim.factIds.length ||
      claim.factIds.some(
        (id) => !ids.has(id) || !markdown.includes("[^" + id + "]"),
      )
    )
      failures.push("Claim has no valid article citation: " + claim.text);
  }
  return failures;
}

function chargeTime(run: Run): void {
  if (run.activeStartedAt) {
    const now = Date.now();
    run.budget.activeMs += Math.max(0, now - Date.parse(run.activeStartedAt));
    run.activeStartedAt = new Date(now).toISOString();
  }
}
function ask(run: Run, text: string): void {
  run.question = { id: run.stage + "-" + randomUUID(), stage: run.stage, text };
  run.status = "awaiting_input";
}

export async function runProducer(
  store: RunStore,
  id: string,
  callerSignal?: AbortSignal,
): Promise<Run> {
  let initial = await store.read(id);
  if (initial.status !== "running") return initial;
  if (initial.budget.reservedUsd > 0) {
    return store.update(id, (run) => {
      run.budget.costUncertain = true;
      run.status = "budget_exhausted";
      run.error =
        "A previous paid attempt has unknown usage; no further spending is allowed";
    });
  }
  const remaining = LIMITS.activeMs - initial.budget.activeMs;
  const signal = callerSignal
    ? AbortSignal.any([
        callerSignal,
        AbortSignal.timeout(Math.max(1, remaining)),
      ])
    : AbortSignal.timeout(Math.max(1, remaining));
  const renderer = createRenderProvider({ brandKey: () => id });
  const closeRenderer = () => {
    void renderer.close?.();
  };
  signal.addEventListener("abort", closeRenderer, { once: true });
  let reserved = 0;
  let attemptId = "";
  const lifecycle: AttemptLifecycle = {
    async before(request, retryAttempt) {
      signal.throwIfAborted();
      attemptId = randomUUID();
      await store.update(id, (run) => {
        if (run.status !== "running")
          throw new Error("Run is no longer processing");
        chargeTime(run);
        reserved = reserveModelCost(run.budget, run.price, request);
      });
      await store.journal(id, {
        provider: "openai",
        operation: "chat_completions",
        attemptId,
        retryAttempt,
        status: "started",
        request,
        reservedUsd: reserved,
      });
    },
    async after(event, request) {
      await store.journal(id, {
        provider: "openai",
        operation: "chat_completions",
        attemptId,
        request,
        response: event.data,
        usage: event.usage,
        latencyMs: event.latencyMs,
        status: event.status,
        error: event.error,
      });
      let failure: unknown;
      await store.update(id, (run) => {
        chargeTime(run);
        try {
          if (!event.ok && event.status >= 400 && event.status < 500)
            run.budget.reservedUsd = Math.max(
              0,
              run.budget.reservedUsd - reserved,
            );
          else if (run.price)
            settleModelCost(run.budget, run.price, reserved, event.usage);
          else throw new BudgetStop("Model pricing is unknown");
        } catch (error) {
          failure = error;
        }
      });

      if (failure) throw failure;
    },
  };
  async function model<T extends z.ZodType>(
    schema: T,
    purpose: string,
    data: { instruction: string; [key: string]: unknown },
    review = false,
  ): Promise<z.infer<T>> {
    const instance = await createAgentModel(
      review ? "editorialProducerReview" : "editorialProducerWrite",
      {
        phase: "editorial-producer-" + purpose,
        attemptLifecycle: lifecycle,
        recordedPrice: (await store.read(id)).price ?? undefined,
      },
    );
    const { instruction, ...untrustedData } = data;
    const result = await instance.invoke(
      [
        {
          role: "system",
          content: EDITORIAL_RULES + "\nTask: " + purpose + "\n" + instruction,
        },
        { role: "user", content: JSON.stringify({ untrustedData }) },
      ],
      {
        signal,
        schema: {
          name: "editorial_" + purpose.replace(/-/g, "_"),
          schema: toStrictJsonSchema(schema),
        },
      },
    );
    if (
      result.refusal ||
      result.finishReason === "length" ||
      result.finishReason === "content_filter"
    )
      throw new Error(
        "Model refusal or incomplete output: " + result.finishReason,
      );
    return schema.parse(JSON.parse(extractJson(result.content ?? "")));
  }
  async function checkpoint(stage: Stage, patch: (run: Run) => void) {
    const run = await store.update(id, (current) => {
      if (current.status !== "running")
        throw new Error("Run is no longer processing");
      chargeTime(current);
      assertBudget(current.budget);
      patch(current);
      current.stage = stage;
    });
    await store.artifact(id, "stage-" + stage + ".json", JSON.stringify(run));
    return run;
  }
  async function step(): Promise<void> {
    signal.throwIfAborted();
    const run = await store.read(id);
    switch (run.stage) {
      case "brief": {
        const brief = await model(BriefSchema, "brief", {
          input: run.input,
          answers: run.answers,
          instruction:
            "Normalize the brief and respect all previous human answers. Ask only when a conflicting or missing audience/intent prevents useful research. An explicit topic, recipient group and angle are sufficient: optional preferences such as gift budget, a particular recipient or product count remain unspecified and must not block work. Do not invent a narrower context such as a gift exchange. Return question:null when the existing brief is usable.",
        });
        await checkpoint(brief.question ? "brief" : "overlap", (current) => {
          current.brief = brief;
          if (brief.question) ask(current, brief.question);
        });
        break;
      }
      case "overlap": {
        if (!run.catalog || !run.content) {
          const context = await loadContext();
          await checkpoint("overlap", (current) => {
            current.catalog = context.catalog;
            current.content = context.content;
          });
        }
        const snapshot = await store.read(id);
        const overlap = await model(OverlapSchema, "overlap", {
          brief: snapshot.brief,
          existing: snapshot.content,
          answers: snapshot.answers,
          instruction:
            "Compare actual primary intent. On real overlap, offer maintaining the existing owner or a distinct angle and ask the human. Human answers settle editorial ownership: when the human already chose a separate article and its distinct angle, return decisionNeeded:false and question:null. Do not ask for confirmation of that choice or raise the same owner again; proceed under the chosen angle. Ask again only about a newly discovered material conflict with a different owner. No publication takes place.",
        });
        if (
          overlap.overlaps.some(
            (item) =>
              !snapshot.content?.some((content) => content.slug === item.slug),
          )
        )
          throw new Error("Invented overlap owner");
        await store.artifact(id, "overlap.json", JSON.stringify(overlap));
        await checkpoint(
          overlap.decisionNeeded ? "overlap" : "catalog",
          (current) => {
            if (overlap.decisionNeeded)
              ask(
                current,
                overlap.question ??
                  "Maintain an existing intent owner, or choose a distinct angle? " +
                    JSON.stringify(overlap.overlaps),
              );
          },
        );
        break;
      }
      case "catalog": {
        const catalog = run.catalog ?? [];
        const result = await model(CatalogSchema, "catalog", {
          brief: run.brief,
          answers: run.answers,
          products: catalog.map((product) => ({
            id: product.id,
            name: product.nameZh,
            nameEn: product.nameEn,
            brand: product.brandName,
            category: product.category,
            subcategory: product.subcategory,
            material: product.material,
            description: product.productDescriptionZh.slice(0, 300),
          })),
          instruction:
            "Make provisional selections with reasons tied to the brief. All catalog facts remain unverified. At most 12 source pages are available; no minimum count. Never prefer easier-to-research products. Explain considered exclusions. Ask if catalog supply requires changing the angle.",
        });
        if (
          [...result.candidates, ...result.exclusions].some(
            (item) => !catalog.some((product) => product.id === item.productId),
          )
        )
          throw new Error("Invented catalog product");
        if (
          new Set(result.candidates.map((item) => item.productId)).size !==
          result.candidates.length
        )
          throw new Error("Duplicate catalog candidate");
        await checkpoint(
          result.question ? "catalog" : "research",
          (current) => {
            current.candidates = result.candidates;
            current.exclusions = result.exclusions;
            if (result.question) ask(current, result.question);
            else if (!result.candidates.length) {
              current.status = "blocked";
              current.error = "Insufficient eligible catalog supply";
            }
          },
        );
        break;
      }
      case "research": {
        const candidates = run.candidates ?? [];
        for (let offset = 0; offset < candidates.length; offset += 2) {
          const outcomes = await Promise.allSettled(
            candidates.slice(offset, offset + 2).map(async (candidate) => {
              const current = await store.read(id);
              if (
                current.sources.some(
                  (source) => source.productId === candidate.productId,
                ) ||
                current.exclusions.some(
                  (item) => item.productId === candidate.productId,
                )
              )
                return;
              const product = current.catalog?.find(
                (item) => item.id === candidate.productId,
              );
              if (!product?.officialUrl)
                throw new Error("Candidate has no eligible official URL");
              const source = await fetchSource(
                store,
                id,
                product.id,
                product.officialUrl,
                renderer,
                signal,
              );
              await checkpoint("research", (target) => {
                if (source) target.sources.push(source);
                else
                  target.exclusions.push({
                    productId: product.id,
                    reason:
                      "Official source unavailable; no facts inferred from catalog copy",
                  });
              });
            }),
          );
          const failure = outcomes.find(
            (outcome) => outcome.status === "rejected",
          );
          if (failure?.status === "rejected") throw failure.reason;
        }
        const snapshot = await store.read(id);
        const extraction = await model(ResearchSchema, "research", {
          brief: snapshot.brief,
          products: snapshot.catalog?.filter((product) =>
            candidates.some((candidate) => candidate.productId === product.id),
          ),
          sources: snapshot.sources.map((source) => ({
            ...source,
            text: source.text.slice(0, 16000),
          })),
          answers: snapshot.answers,
          instruction:
            "Confirm exact product/variant and official entity identity with a literal identity excerpt. Extract only relevant durable facts, each with one contiguous verbatim quote from source.text. Never shorten quotes with ellipses, merge separate passages or normalize characters. Exclude mismatches or unsupported specifications; ask if evidence requires an angle change.",
        });
        const facts: Fact[] = [];
        const exclusions = [...snapshot.exclusions];
        for (const product of extraction.products) {
          const source = snapshot.sources.find(
            (item) =>
              item.id === product.sourceId &&
              item.productId === product.productId,
          );
          if (
            !source ||
            !product.identityConfirmed ||
            !product.identityExcerpt.trim() ||
            !source.text.includes(product.identityExcerpt)
          ) {
            exclusions.push({
              productId: product.productId,
              reason:
                product.exclusionReason ??
                "Exact product/variant identity was not evidenced",
            });
            continue;
          }
          for (const fact of product.facts) {
            if (!fact.excerpt.trim() || !source.text.includes(fact.excerpt)) {
              exclusions.push({
                productId: product.productId,
                reason:
                  "Evidence excerpt does not occur in its source: " +
                  fact.claim,
              });
              continue;
            }
            facts.push({
              id: "f" + (facts.length + 1),
              productId: product.productId,
              sourceId: source.id,
              ...fact,
            });
          }
        }
        await store.artifact(
          id,
          "research-extraction.json",
          JSON.stringify(extraction),
        );
        if (facts.length) {
          const review = await model(
            FactsReviewSchema,
            "facts-review",
            {
              facts,
              sources: snapshot.sources,
              products: snapshot.catalog?.filter((product) =>
                candidates.some(
                  (candidate) => candidate.productId === product.id,
                ),
              ),
              instruction:
                "Independently verify every fact against its excerpt and source, product identity, seller identity and variant. Reject extrapolated claims. Return supportedFactIds only when semantically supported.",
            },
            true,
          );
          const supported = new Set(
            review.failures.length ? [] : review.supportedFactIds,
          );
          for (const fact of facts)
            if (!supported.has(fact.id))
              exclusions.push({
                productId: fact.productId,
                reason: "Unsupported fact: " + fact.claim,
              });
          await store.artifact(id, "facts-review.json", JSON.stringify(review));
          await checkpoint(
            extraction.question ? "research" : "outline",
            (current) => {
              current.facts = facts.filter((fact) => supported.has(fact.id));
              current.exclusions = exclusions;
              if (extraction.question) ask(current, extraction.question);
              else if (!current.facts.length) {
                current.status = "blocked";
                current.error = "No independently supported facts";
              }
            },
          );
        } else {
          await checkpoint(
            extraction.question ? "research" : "outline",
            (current) => {
              current.exclusions = exclusions;
              if (extraction.question) ask(current, extraction.question);
              else {
                current.status = "blocked";
                current.error = "Insufficient official evidence";
              }
            },
          );
        }
        break;
      }
      case "outline": {
        const result = await model(OutlineSchema, "outline", {
          brief: run.brief,
          candidates: run.candidates,
          facts: run.facts,
          exclusions: run.exclusions,
          answers: run.answers,
          instruction:
            "Outline a complete article satisfying the brief using only supported facts. Ask if the angle must change. No word-count or product-count quota.",
        });
        await checkpoint(result.question ? "outline" : "draft", (current) => {
          current.outline = result.outline;
          if (result.question) ask(current, result.question);
        });
        break;
      }
      case "draft": {
        const result = await model(DraftSchema, "draft", {
          brief: run.brief,
          outline: run.outline,
          candidates: run.candidates,
          facts: run.facts,
          failures: run.review?.failures,
          answers: run.answers,
          instruction:
            "Write the full natural zh-TW Markdown article. Cite facts with [^f1] style references. Return a complete claim ledger: exact article text for each factual assertion and its factIds. Distinguish interpretations, make no unsupported product claims. Do not add footnote definitions; the service adds source links. All selections remain provisional.",
        });
        await checkpoint("review", (current) => {
          current.draft = result.markdown;
          current.claims = result.claims;
          current.review = {
            failures: [],
            openDecisions: result.openDecisions,
          };
        });
        await store.artifact(id, "draft.md", result.markdown);
        break;
      }
      case "review": {
        const deterministic = validateDraft(run);
        const result = await model(
          ReviewSchema,
          "draft-review",
          {
            brief: run.brief,
            article: run.draft,
            claims: run.claims,
            facts: run.facts,
            sources: run.sources,
            candidates: run.candidates,
            deterministicFailures: deterministic,
            instruction:
              "Review independently with fresh context. Find ALL factual assertions, including those omitted from the claim ledger. Check semantic support, exact product/variant identity, coverage of brief, prohibited claims, natural zh-TW and voice. Unsupported important facts or missing citations are failures. Never accept solely because a citation/JSON exists. Open decisions do not permit unsupported factual assertions.",
          },
          true,
        );
        const failures = [...new Set([...deterministic, ...result.failures])];
        const repeat =
          failures.length > 0 && run.budget.revisions < LIMITS.revisions;
        await checkpoint(repeat ? "draft" : "done", (current) => {
          current.review = {
            failures,
            openDecisions: [
              ...new Set([
                ...(current.review?.openDecisions ?? []),
                ...result.openDecisions,
              ]),
            ],
          };
          if (repeat) current.budget.revisions++;
          else {
            current.status = failures.length ? "blocked" : "ready_for_review";
            if (failures.length)
              current.error = "Review failures remain after bounded revisions";
          }
        });
        break;
      }
      case "done":
        break;
    }
  }
  try {
    initial = await store.update(id, (run) => {
      assertBudget(run.budget);
      run.activeStartedAt = new Date().toISOString();
    });
    if (!initial.price) {
      const price = await getModelPrice(resolveOpenAIModel());
      if (!price) throw new BudgetStop("Model pricing is unknown");
      await store.update(id, (run) => {
        run.price = price;
      });
    }
    const state = Annotation.Root({ status: Annotation<string>() });
    const graph = new StateGraph(state)
      .addNode("stage", async () => {
        await step();
        return { status: (await store.read(id)).status };
      })
      .addEdge(START, "stage")
      .addConditionalEdges("stage", (current) =>
        current.status === "running" ? "stage" : END,
      )
      .compile();
    await runWithAuditContext({ correlationId: id }, () =>
      graph.invoke({ status: "running" }, { signal, recursionLimit: 24 }),
    );
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    await store.update(id, (run) => {
      chargeTime(run);
      if (run.budget.reservedUsd > 0) run.budget.costUncertain = true;
      if (run.status === "running") {
        run.status =
          cause instanceof BudgetStop ||
          run.budget.costUncertain ||
          (!callerSignal?.aborted && signal.aborted)
            ? "budget_exhausted"
            : callerSignal?.reason === "cancelled_by_operator"
              ? "cancelled"
              : "interrupted";
        run.error = error instanceof Error ? error.message : String(error);
      }
    });
  } finally {
    signal.removeEventListener("abort", closeRenderer);
    await renderer.close?.();
    await store.update(id, (run) => {
      chargeTime(run);
      run.activeStartedAt = null;
    });
  }
  return store.read(id);
}
