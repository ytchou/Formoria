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
  chargeReservation,
  reserveModelCost,
  settleModelCost,
} from "./budget";
import {
  EDITORIAL_DRAFT_INSTRUCTION,
  EDITORIAL_RULES,
} from "@/lib/prompts/editorial-producer";
import { fetchSource, loadContext } from "./sources";
import { RunStore } from "./store";
import {
  LIMITS,
  type Claim,
  type Fact,
  type Run,
  type Stage,
  type TrailDraft,
} from "./types";

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
  title: z.string().min(1),
  description: z.string().min(1),
  slug: z.string().min(1),
  promise: z.string().min(1),
  readerSituation: z.string().min(1),
  exclusions: z.string().min(1),
  intro: z.string().min(1),
  sections: z.array(
    z.object({
      key: z.string().min(1),
      title: z.string().min(1),
      body: z.string().min(1),
      picks: z.array(
        z.object({
          productId: z.string(),
          note: z.string(),
          factIds: z.array(z.string()),
        }),
      ),
    }),
  ),
  closing: z.string(),
  openDecisions: z.array(z.string()),
});
/** Mirrors NOTE_MAX_CHARS in scripts/trails/lib.ts and the trail frontmatter check. */
export const NOTE_MAX_CHARS = 20;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ReviewSchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(["blocking", "revise"]),
      quote: z.string(),
      problem: z.string().min(1),
      falseBelief: z.string(),
    }),
  ),
  openDecisions: z.array(z.string()),
});
const MAX_REVIEW_DECISIONS = 5;

const CITATION = /\[\^([^\]]+)\]/g;
const SENTENCE = /[^。！？!?\n]+[。！？!?]?(?:\s*\[\^[^\]]+\])*/g;
function stripCitations(text: string): string {
  return text.replace(CITATION, "").trim();
}
/** Sentences with citation markers removed, for comparing drafts. */
function sentences(markdown: string): string[] {
  return (markdown.match(SENTENCE) ?? [])
    .map((sentence) => sentence.replace(CITATION, "").trim())
    .filter(Boolean);
}
/**
 * The claim ledger is derived from the article, not restated by the writer:
 * every sentence carrying a [^fN] marker is a claim backed by those facts.
 * A model-restated ledger failed exact matching on its own article.
 */
export function deriveClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];
  for (const sentence of markdown.match(SENTENCE) ?? []) {
    const factIds = [...sentence.matchAll(CITATION)].map((match) => match[1]!);
    if (!factIds.length) continue;
    const text = sentence.replace(CITATION, "").trim();
    if (text) claims.push({ text, factIds: [...new Set(factIds)] });
  }
  return claims;
}

/**
 * The review copy of a trail: prose and one line per product card, each card
 * line carrying its note's fact markers so review and the claim ledger cover
 * card notes as well as prose. Delivery renders the MDX from run.trail.
 */
export function trailMarkdown(
  run: Pick<Run, "catalog">,
  trail: TrailDraft,
): string {
  const name = (productId: string) => {
    const product = run.catalog?.find((item) => item.id === productId);
    return product ? product.brandName + " " + product.nameZh : productId;
  };
  return [
    "# " + trail.title,
    trail.intro,
    ...trail.sections.flatMap((section) => [
      "## " + section.title,
      section.body,
      section.picks
        .map(
          (pick) =>
            '- Card for catalog product "' +
            name(pick.productId) +
            '", note: ' +
            pick.note +
            pick.factIds.map((id) => "[^" + id + "]").join(""),
        )
        .join("\n"),
    ]),
    trail.closing,
  ]
    .filter((block) => block.trim())
    .join("\n\n");
}

/** Contract checks the trail MDX and picks.json must pass before delivery. */
function trailFailures(run: Pick<Run, "trail" | "facts">): string[] {
  const trail = run.trail;
  if (!trail) return [];
  const failures: string[] = [];
  if (!KEBAB.test(trail.slug))
    failures.push("Trail slug is not kebab-case: " + trail.slug);
  if (!trail.sections.length) failures.push("Trail has no sections");
  // Published trails keep product facts on the cards; prose carries criteria.
  for (const prose of [
    trail.intro,
    trail.closing,
    ...trail.sections.map((section) => section.body),
  ])
    if (prose.match(CITATION))
      failures.push(
        "Trail prose states product facts; keep facts in card notes: " +
          stripCitations(prose).slice(0, 40),
      );
  const keys = new Set<string>();
  const titles = new Set<string>();
  const picked = new Set<string>();
  for (const section of trail.sections) {
    if (!KEBAB.test(section.key) || keys.has(section.key))
      failures.push(
        "Section key is missing, malformed or repeated: " + section.key,
      );
    if (titles.has(section.title))
      failures.push("Section title is repeated: " + section.title);
    keys.add(section.key);
    titles.add(section.title);
    if (!section.picks.length)
      failures.push("Section has no products: " + section.title);
    for (const pick of section.picks) {
      if (picked.has(pick.productId))
        failures.push("Product appears in more than one section: " + pick.note);
      picked.add(pick.productId);
      if (!pick.note.trim() || [...pick.note.trim()].length > NOTE_MAX_CHARS)
        failures.push(
          "Card note must be 1 to " +
            NOTE_MAX_CHARS +
            " characters: " +
            pick.note,
        );
      if (
        !pick.factIds.length ||
        pick.factIds.some(
          (factId) =>
            !run.facts.some(
              (fact) => fact.id === factId && fact.productId === pick.productId,
            ),
        )
      )
        failures.push(
          "Card note is not backed by facts about its own product: " +
            pick.note,
        );
    }
  }
  return failures;
}

export function validateDraft(
  run: Pick<Run, "draft" | "claims" | "facts" | "trail">,
): string[] {
  const failures: string[] = [...trailFailures(run)];
  const ids = new Set(run.facts.map((fact) => fact.id));
  const markdown = run.draft ?? "";
  if (!markdown.trim()) failures.push("Draft is empty");
  for (const match of markdown.matchAll(CITATION))
    if (!ids.has(match[1]!)) failures.push("Unknown citation: " + match[1]);
  if (markdown.trim() && ids.size && !run.claims.length)
    failures.push("Article cites none of the supported facts");
  return [...new Set(failures)];
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
/**
 * Models corrupt 36-character UUIDs when copying them back (one pilot run
 * returned a catalog ID with its last twelve characters rewritten), so prompts
 * carry short aliases such as p1/s1 and results are mapped back here.
 */
function aliases<T>(items: T[], prefix: string, key: (item: T) => string) {
  const toReal = new Map(items.map((item, i) => [prefix + (i + 1), key(item)]));
  const toAlias = new Map([...toReal].map(([alias, real]) => [real, alias]));
  return { toReal, toAlias };
}
/**
 * Candidates the article may feature: those with at least one supported fact,
 * named as the catalog names them (identity was confirmed during research).
 */
function evidenced(run: Run) {
  return run.candidates
    ?.filter((candidate) =>
      run.facts.some((fact) => fact.productId === candidate.productId),
    )
    .map((candidate) => {
      const product = run.catalog?.find(
        (item) => item.id === candidate.productId,
      );
      return {
        ...candidate,
        name: product?.nameZh,
        nameEn: product?.nameEn,
        brand: product?.brandName,
      };
    });
}
/** Replaces prompt aliases (p7) in model text shown to humans with product names. */
function unalias(
  run: Run,
  text: string,
  ids: ReturnType<typeof aliases>,
): string {
  return text.replace(/\bp\d+\b/g, (alias) => {
    const id = ids.toReal.get(alias);
    const product = run.catalog?.find((item) => item.id === id);
    return product ? "「" + product.nameZh + "」" : alias;
  });
}
/**
 * After the brief and overlap are settled, a question that does not stop the
 * work (candidates or facts exist) is an editorial decision for the packet,
 * not a checkpoint. Models otherwise ask hypothetical "if supply runs short"
 * questions with a usable selection in hand.
 */
function deferDecision(run: Run, text: string): void {
  run.decisions ??= [];
  if (!run.decisions.includes(text)) run.decisions.push(text);
}

export async function runProducer(
  store: RunStore,
  id: string,
  callerSignal?: AbortSignal,
): Promise<Run> {
  let initial = await store.read(id);
  if (initial.status !== "running") return initial;
  if (initial.budget.reservedUsd > 0 && !initial.budget.costUncertain) {
    // The process died mid-call: charge the outstanding reservation as spent.
    initial = await store.update(id, (run) => {
      chargeReservation(run.budget, run.budget.reservedUsd);
    });
    await store.journal(id, {
      provider: "openai",
      operation: "chat_completions",
      status: "charged_unsettled_reservation",
      costUsd: initial.budget.costUsd,
    });
  }
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
          // A timeout, abort or 5xx reports no usage; charge the whole
          // reservation as the worst case so the cap holds and the run can retry.
          else if (!event.ok && !event.usage)
            chargeReservation(run.budget, reserved);
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
    const profile = review
      ? "editorialProducerReview"
      : "editorialProducerWrite";
    const instance = await createAgentModel(profile, {
      phase: profile,
      attemptLifecycle: lifecycle,
      recordedPrice: (await store.read(id)).price ?? undefined,
    });
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
        const productIds = aliases(catalog, "p", (product) => product.id);
        const result = await model(CatalogSchema, "catalog", {
          brief: run.brief,
          answers: run.answers,
          products: catalog.map((product) => ({
            id: productIds.toAlias.get(product.id),
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
        const unknown = [...result.candidates, ...result.exclusions]
          .map((item) => item.productId)
          .filter((alias) => !productIds.toReal.has(alias));
        if (unknown.length)
          await store.journal(id, {
            stage: "catalog",
            droppedUnknownProductIds: unknown,
          });
        const resolve = <T extends { productId: string; reason: string }>(
          items: T[],
        ) => {
          const seen = new Set<string>();
          return items.flatMap((item) => {
            const productId = productIds.toReal.get(item.productId);
            if (!productId || seen.has(productId)) return [];
            seen.add(productId);
            return [
              {
                ...item,
                productId,
                reason: unalias(run, item.reason, productIds),
              },
            ];
          });
        };
        const candidates = resolve(result.candidates);
        const mustAsk = !!result.question && !candidates.length;
        await checkpoint(mustAsk ? "catalog" : "research", (current) => {
          current.candidates = candidates;
          current.exclusions = resolve(result.exclusions);
          const question = result.question
            ? unalias(current, result.question, productIds)
            : null;
          if (mustAsk) ask(current, question!);
          else if (question) deferDecision(current, question);
          else if (!candidates.length) {
            current.status = "blocked";
            current.error = "Insufficient eligible catalog supply";
          }
        });
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
        const researched =
          snapshot.catalog?.filter((product) =>
            candidates.some((candidate) => candidate.productId === product.id),
          ) ?? [];
        const productIds = aliases(researched, "p", (product) => product.id);
        const sourceIds = aliases(snapshot.sources, "s", (source) => source.id);
        const extraction = await model(ResearchSchema, "research", {
          brief: snapshot.brief,
          products: researched.map((product) => ({
            ...product,
            id: productIds.toAlias.get(product.id),
          })),
          sources: snapshot.sources.map((source) => ({
            ...source,
            id: sourceIds.toAlias.get(source.id),
            productId: productIds.toAlias.get(source.productId),
            text: source.text.slice(0, 16000),
          })),
          answers: snapshot.answers,
          instruction:
            "Confirm exact product/variant and official entity identity with a literal identity excerpt. Extract only relevant durable facts, each with one contiguous verbatim quote from source.text. Never shorten quotes with ellipses, merge separate passages or normalize characters. Also extract, as separate facts, every usage restriction, caution or warning the page states for the product (who should not use it, what not to do, required accessories not included). Never extract commerce facts, even as restrictions: price, discounts, stock or availability, sold-out status, made-to-order or production lead times, shipping, delivery, returns or ordering instructions; Formoria links to the source for those. Exclude mismatches or unsupported specifications; ask if evidence requires an angle change.",
        });
        const facts: Fact[] = [];
        const exclusions = [...snapshot.exclusions];
        const rejectedFacts: NonNullable<Run["rejectedFacts"]> = [];
        for (const extracted of extraction.products) {
          const productId = productIds.toReal.get(extracted.productId);
          if (!productId) {
            await store.journal(id, {
              stage: "research",
              droppedUnknownProductId: extracted.productId,
            });
            continue;
          }
          const product = { ...extracted, productId };
          const source = snapshot.sources.find(
            (item) =>
              item.id === sourceIds.toReal.get(product.sourceId) &&
              item.productId === productId,
          );
          if (
            !source ||
            !product.identityConfirmed ||
            !product.identityExcerpt.trim() ||
            !source.text.includes(product.identityExcerpt)
          ) {
            exclusions.push({
              productId: product.productId,
              reason: product.exclusionReason
                ? unalias(snapshot, product.exclusionReason, productIds)
                : "Exact product/variant identity was not evidenced",
            });
            continue;
          }
          for (const fact of product.facts) {
            if (!fact.excerpt.trim() || !source.text.includes(fact.excerpt)) {
              rejectedFacts.push({
                productId: product.productId,
                claim: fact.claim,
                reason: "Evidence excerpt does not occur in its source",
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
              sources: snapshot.sources.map((source) => ({
                ...source,
                text: source.text.slice(0, 16000),
              })),
              products: snapshot.catalog?.filter((product) =>
                candidates.some(
                  (candidate) => candidate.productId === product.id,
                ),
              ),
              instruction:
                "Independently verify every fact against its excerpt and source, product identity, seller identity and variant. Reject extrapolated claims. Return supportedFactIds only when semantically supported; failures explain rejected facts and must not contradict that list. If a product identity is uncertain, reject every fact about that product. If a concern invalidates the entire evidence batch, return no supportedFactIds.",
            },
            true,
          );
          const supported = new Set(review.supportedFactIds);
          for (const fact of facts)
            if (!supported.has(fact.id))
              rejectedFacts.push({
                productId: fact.productId,
                claim: fact.claim,
                reason: "Independent review found it unsupported",
              });
          await store.artifact(id, "facts-review.json", JSON.stringify(review));
          const kept = facts.filter((fact) => supported.has(fact.id));
          const mustAsk = !!extraction.question && !kept.length;
          await checkpoint(mustAsk ? "research" : "outline", (current) => {
            current.facts = kept;
            current.exclusions = exclusions;
            current.rejectedFacts = rejectedFacts;
            const question = extraction.question
              ? unalias(current, extraction.question, productIds)
              : null;
            if (mustAsk) ask(current, question!);
            else if (question) deferDecision(current, question);
            else if (!current.facts.length) {
              current.status = "blocked";
              current.error = "No independently supported facts";
            }
          });
        } else {
          await checkpoint(
            extraction.question ? "research" : "outline",
            (current) => {
              current.exclusions = exclusions;
              current.rejectedFacts = rejectedFacts;
              if (extraction.question)
                ask(current, unalias(current, extraction.question, productIds));
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
        await checkpoint("draft", (current) => {
          current.outline = result.outline;
          if (result.question) deferDecision(current, result.question);
        });
        break;
      }
      case "draft": {
        const featured = evidenced(run) ?? [];
        const productIds = aliases(
          featured,
          "p",
          (candidate) => candidate.productId,
        );
        const alias = (productId: string) =>
          productIds.toAlias.get(productId) ?? productId;
        const result = await model(DraftSchema, "draft", {
          brief: run.brief,
          outline: run.outline,
          products: featured.map((candidate) => ({
            ...candidate,
            productId: alias(candidate.productId),
          })),
          facts: run.facts.map((fact) => ({
            ...fact,
            productId: alias(fact.productId),
            sourceUrl: run.sources.find((source) => source.id === fact.sourceId)
              ?.finalUrl,
          })),
          answers: run.answers,
          openDecisions: run.decisions,
          formatExamples: (run.content ?? [])
            .filter((item) => item.kind === "trail" && !item.draft)
            .slice(0, 2)
            .map((item) => ({ title: item.title, body: item.content })),
          ...(run.trail && run.review?.failures.length
            ? {
                previousTrail: {
                  ...run.trail,
                  sections: run.trail.sections.map((section) => ({
                    ...section,
                    picks: section.picks.map((pick) => ({
                      ...pick,
                      productId: alias(pick.productId),
                    })),
                  })),
                },
                reviewFailures: run.review.failures,
              }
            : {}),
          instruction: EDITORIAL_DRAFT_INSTRUCTION,
        });
        const { openDecisions, ...written } = result;
        const unknown = written.sections
          .flatMap((section) => section.picks)
          .map((pick) => pick.productId)
          .filter((productId) => !productIds.toReal.has(productId));
        if (unknown.length)
          await store.journal(id, {
            stage: "draft",
            droppedUnknownProductIds: unknown,
          });
        const trail: TrailDraft = {
          ...written,
          sections: written.sections.map((section) => ({
            ...section,
            picks: section.picks.flatMap((pick) => {
              const productId = productIds.toReal.get(pick.productId);
              return productId ? [{ ...pick, productId }] : [];
            }),
          })),
        };
        const markdown = trailMarkdown(run, trail);
        await checkpoint("review", (current) => {
          current.trail = trail;
          current.draft = markdown;
          current.claims = deriveClaims(markdown);
          current.review = {
            failures: [],
            notes: [],
            openDecisions: [
              ...new Set([
                ...(current.decisions ?? []),
                ...openDecisions.slice(0, MAX_REVIEW_DECISIONS),
              ]),
            ],
          };
        });
        await store.artifact(id, "review-draft.md", markdown);
        break;
      }
      case "review": {
        const deterministic = validateDraft(run);
        // Later rounds may only block on what changed or stayed broken: an
        // unchanged sentence already passed an independent review. Without this
        // a fresh reviewer finds new nits in every full pass and never converges.
        const previous = run.reviewed;
        const seen = new Set(previous ? sentences(previous.draft) : []);
        const changed = previous
          ? sentences(run.draft ?? "").filter((sentence) => !seen.has(sentence))
          : null;
        const result = await model(
          ReviewSchema,
          "draft-review",
          {
            brief: run.brief,
            answers: run.answers,
            article: run.draft,
            facts: run.facts,
            sources: run.sources.map((source) => ({
              ...source,
              text: source.text.slice(0, 16000),
            })),
            candidates: evidenced(run),
            openDecisions: run.review?.openDecisions,
            deterministicFailures: deterministic,
            ...(changed
              ? {
                  changedSentences: changed,
                  previousFailures: previous!.failures,
                }
              : {}),
            instruction:
              "Review independently with fresh context. Find ALL factual assertions, including uncited ones, and check each cited sentence against its facts' excerpts. Classify every issue. severity blocking ONLY when publishing the sentence as written would mislead a reader: a product fact unsupported by its cited excerpts or stated without a [^fN] marker; a fact attributed to the wrong product, variant, brand or seller; a prohibited claim (price, stock, discount, delivery promise, certification, safety, efficacy, superiority); brand nationality presented as manufacturing origin; or a use described while omitting safety restrictions its source states for that use (who should not use it). Care, cleaning and handling instructions are never required. Everything else is severity revise: naming precision, variant labels, source labels, wording, tone, structure, hedging. A blocking issue must be fixable by editing or deleting the quoted text using the provided facts. Never blocking: a pronoun or short name for the product named where its paragraph begins; facts the article leaves out; not naming a brand, seller or marketplace in the article (identity was verified during research); units, translations or variant labels; editorial interpretations clearly framed as such; suggestions. A sentence is supported when the excerpts of the facts it cites cover what it states, even if the page says more. When unsure, choose revise: a human editor reviews every draft before publication, and the draft is explicitly provisional. For a blocking issue, falseBelief states the specific false thing a reader would believe after reading the quoted text; if the text is accurate and you only want clearer or more cautious wording, the issue is revise and falseBelief is empty. Quote the offending text in quote. The article is the review copy of a discovery trail: prose sections, and under each section one 'Card for catalog product <name>, note: ...' line per product card. The quoted name is the catalog's title for the card, outside the writer's control and identity-checked in research: never raise issues about it; review only the note, which must be supported by its own markers. The card names the product, so prose need not name each product or list its specifications. A fact the source states for the product without distinguishing its listed variants (for example a size shared by all colours) is supported for every variant. Markers are removed and source URLs listed separately at delivery: never ask for footnotes or source lists. Human answers are settled editorial decisions: never re-raise them. openDecisions: at most five choices that need human editorial judgment (selection, angle, inclusion), not verification chores. When changedSentences and previousFailures are present this is a re-review: report a previous failure again as blocking only if it is still unresolved, and raise new blocking issues only about changedSentences; other sentences already passed review.",
          },
          true,
        );
        const describe = (issue: (typeof result.issues)[number]) =>
          (issue.quote ? "「" + issue.quote + "」: " : "") +
          issue.problem +
          (issue.falseBelief.trim()
            ? " (reader would believe: " + issue.falseBelief.trim() + ")"
            : "");
        // A blocking issue must name the false belief it causes; one that
        // cannot is a wording suggestion and is downgraded to a note.
        const bare = (text: string) => text.replace(CITATION, "").trim();
        const inScope = (quote: string) =>
          !changed ||
          !quote ||
          changed.some(
            (sentence) => sentence.includes(quote) || quote.includes(sentence),
          ) ||
          previous!.failures.some((failure) => failure.includes(quote));
        const blocks = (issue: (typeof result.issues)[number]) =>
          issue.severity === "blocking" &&
          !!issue.falseBelief.trim() &&
          inScope(bare(issue.quote));
        const failures = [
          ...new Set([
            ...deterministic,
            ...result.issues.filter(blocks).map(describe),
          ]),
        ];
        const notes = result.issues
          .filter((issue) => !blocks(issue))
          .map(describe);
        const repeat =
          failures.length > 0 && run.budget.revisions < LIMITS.revisions;
        await checkpoint(repeat ? "draft" : "done", (current) => {
          current.reviewed = { draft: run.draft ?? "", failures };
          current.review = {
            failures,
            notes,
            openDecisions: [
              ...new Set([
                ...(current.review?.openDecisions ?? []),
                ...result.openDecisions.slice(0, MAX_REVIEW_DECISIONS),
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
