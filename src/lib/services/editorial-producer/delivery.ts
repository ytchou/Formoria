import {
  completeFileUpload,
  getFileUploadUrl,
  postMessage,
  uploadFileBytes,
  SlackUploadRejected,
} from "@/lib/adapters/slack/web-api";
import matter from "gray-matter";
import { renderThreadNotice } from "@/lib/adapters/slack/blocks";
import { EDITORIAL_BYLINE } from "@/lib/prompts/editorial-producer";
import { pickNoteKey } from "@/lib/trails/note-key";
import { LIMITS, type Run } from "./types";
import type { RunStore } from "./store";

export function evidencePacket(run: Run): string {
  const productLead = (productId: string) => {
    const product = run.catalog?.find((item) => item.id === productId);
    return {
      name: product?.nameZh,
      nameEn: product?.nameEn,
      brand: product?.brandName,
      catalogLeadUrl: product?.officialUrl,
    };
  };
  return (
    "# Editorial Producer evidence packet\n\n" +
    "Run: " +
    run.id +
    "\nStatus: " +
    run.status +
    "\nCreated: " +
    run.createdAt +
    "\n\n" +
    "All selections are provisional. Human selection, cultural review and publication remain required.\n\n" +
    "## Brief and decisions\n\n```json\n" +
    JSON.stringify(
      {
        input: run.input,
        brief: run.brief,
        answers: run.answers,
        pendingQuestion: run.question,
      },
      null,
      2,
    ) +
    "\n```\n\n" +
    "## Provisional selections and exclusions\n\n```json\n" +
    JSON.stringify(
      {
        candidates: run.candidates?.map((item) => ({
          ...item,
          ...productLead(item.productId),
        })),
        exclusions: run.exclusions.map((item) => ({
          ...item,
          ...productLead(item.productId),
        })),
        rejectedFacts: run.rejectedFacts?.map((item) => ({
          ...item,
          name: productLead(item.productId).name,
        })),
      },
      null,
      2,
    ) +
    "\n```\n\nCatalog labels and lead URLs identify provisional products; they are not evidence.\n\n" +
    "## Sources inspected\n\n```json\n" +
    JSON.stringify(
      run.sources.map(({ text: _text, ...source }) => source),
      null,
      2,
    ) +
    "\n```\n\n## Claim evidence\n\n" +
    run.facts
      .map((fact) => {
        const source = run.sources.find((item) => item.id === fact.sourceId);
        return (
          "### " +
          fact.id +
          "\n\n" +
          fact.claim +
          "\n\n> " +
          fact.excerpt.replaceAll("\n", "\n> ") +
          "\n\nSource: " +
          (source?.finalUrl ?? "MISSING") +
          "\nProduct ID: " +
          fact.productId +
          "\nFetched: " +
          (source?.fetchedAt ?? "MISSING")
        );
      })
      .join("\n\n") +
    "\n\n## Review and unresolved decisions\n\n```json\n" +
    JSON.stringify(
      { review: run.review, error: run.error, claimLedger: run.claims },
      null,
      2,
    ) +
    "\n```\n\n" +
    (run.trail
      ? "## Before publishing\n\n" +
        "- Save trail.mdx as content/trails/" +
        run.trail.slug +
        ".mdx and add heroImage, heroImageAlt, reviewedAt and reviewDueAt; node scripts/checks/trail-frontmatter.mjs names anything missing.\n" +
        "- Review the picks, then place them with npx tsx scripts/trails/apply-picks.ts --trail " +
        run.trail.slug +
        " --picks picks.json --dry-run, and again without --dry-run.\n" +
        "- Set draft: false only after human editorial and publication approval.\n\n"
      : "") +
    "## Actual usage\n\n```json\n" +
    JSON.stringify(
      {
        ...run.budget,
        activeProcessingSeconds: Math.round(run.budget.activeMs / 1000),
        model: run.price?.model,
        recordedPrice: run.price,
        limits: LIMITS,
      },
      null,
      2,
    ) +
    "\n```\n\n" +
    "Ops routing and Railway hosting are separate charges. Model review may share writer blind spots; human spot-check required. Full adapter payloads and checkpoints remain in private worker storage. No measured efficiency gain is claimed.\n"
  );
}
const MARKER = /\s*\[\^([^\]]+)\]/g;
function stripMarkers(text: string): string {
  return text.replace(MARKER, "").trim();
}
function catalogEntry(run: Run, productId: string) {
  const product = run.catalog?.find((item) => item.id === productId);
  if (!product) throw new Error("Trail pick is not in the catalog snapshot");
  return product;
}

/**
 * The draft as a content/trails/<slug>.mdx document: the same frontmatter and
 * <TrailProducts> layout as published trails, with citation markers removed
 * (evidence.md keeps the sentence-to-source ledger). It stays draft: true;
 * heroImage, review dates and publication are human decisions.
 */
export function trailFile(run: Run): string {
  const trail = run.trail;
  if (!trail) throw new Error("Run has no trail draft");
  const cited = new Set(
    [...(run.draft ?? "").matchAll(MARKER)].map((match) => match[1]),
  );
  const sources = [
    ...new Set(
      run.facts
        .filter((fact) => cited.has(fact.id))
        .flatMap(
          (fact) =>
            run.sources.find((source) => source.id === fact.sourceId)
              ?.finalUrl ?? [],
        ),
    ),
  ];
  const picks = trail.sections.flatMap((section) => section.picks);
  const tags = [
    ...new Set(picks.map((pick) => catalogEntry(run, pick.productId).category)),
  ];
  const frontmatter = {
    title: trail.title,
    description: trail.description,
    slug: trail.slug,
    tags,
    locale: "zh-TW",
    publishedAt: run.createdAt.slice(0, 10),
    draft: true,
    author: EDITORIAL_BYLINE,
    sources,
    promise: trail.promise,
    readerSituation: trail.readerSituation,
    sections: trail.sections.map((section) => ({
      key: section.key,
      title: section.title,
      notes: Object.fromEntries(
        section.picks.map((pick) => {
          const product = catalogEntry(run, pick.productId);
          return [pickNoteKey(product.brandSlug, product.key), pick.note];
        }),
      ),
    })),
    exclusions: trail.exclusions,
    editorialOwner: EDITORIAL_BYLINE,
    relatedCategories: [...tags],
    relatedStories: [],
    relatedTrails: [],
  };
  const body = [
    ...(run.status === "ready_for_review"
      ? []
      : [
          "{/* Partial draft: " +
            run.status +
            "; not ready for review or publication. */}",
        ]),
    stripMarkers(trail.intro),
    ...trail.sections.map(
      (section) =>
        '<section id="' +
        section.key +
        '">\n\n## ' +
        section.title +
        "\n\n" +
        stripMarkers(section.body) +
        '\n\n<TrailProducts section="' +
        section.key +
        '" />\n\n</section>',
    ),
    stripMarkers(trail.closing),
  ]
    .filter(Boolean)
    .join("\n\n");
  // js-yaml option passed through by gray-matter; untyped there. -1 keeps long
  // source URLs on one line, as published trails write them.
  return matter.stringify("\n" + body + "\n", frontmatter, {
    lineWidth: -1,
  } as Parameters<typeof matter.stringify>[2]);
}

/** The placements for scripts/trails/apply-picks.ts, which a human runs. */
export function trailPicks(run: Run): string {
  const trail = run.trail;
  if (!trail) throw new Error("Run has no trail draft");
  return (
    JSON.stringify(
      {
        trail: trail.slug,
        sections: Object.fromEntries(
          trail.sections.map((section) => [
            section.key,
            section.picks.map((pick) => {
              const product = catalogEntry(run, pick.productId);
              return {
                brandSlug: product.brandSlug,
                productKey: product.key,
                note: pick.note,
              };
            }),
          ]),
        ),
      },
      null,
      2,
    ) + "\n"
  );
}
export async function notifyRun(store: RunStore, id: string): Promise<void> {
  const run = await store.read(id);
  const body =
    run.status === "awaiting_input"
      ? (run.question?.text ?? "Reply with your editorial decision.")
      : "Status: " +
        run.status +
        ". Stage: " +
        run.stage +
        ". Model usage: US$" +
        run.budget.costUsd.toFixed(4) +
        " / US$1." +
        (run.error ? " Reason: " + run.error + "." : "") +
        (run.budget.costUncertain
          ? " Additional usage is uncertain; further spending stopped."
          : "") +
        " Reply status, resume, cancel, or retry delivery in this thread.";
  const notice = renderThreadNotice({
    title: "Editorial Producer",
    body,
    context: "Run: " + run.id,
  });
  const response = await postMessage({
    channel: run.channelId,
    threadTs: run.threadTs,
    ...notice,
  });
  await store.journal(id, {
    provider: "slack",
    operation: "post_message",
    request: { channel: run.channelId, threadTs: run.threadTs, ...notice },
    response,
  });
  if (!response.ok)
    throw new Error("Slack notification failed: " + response.error);
}
export async function deliverRun(store: RunStore, id: string): Promise<void> {
  let run = await store.read(id);
  const files = {
    ...(run.trail
      ? { "trail.mdx": trailFile(run), "picks.json": trailPicks(run) }
      : {}),
    "evidence.md": evidencePacket(run),
  };
  for (const [name, contents] of Object.entries(files)) {
    await store.artifact(id, name, contents);
    let file = run.delivery.files[name];
    if (file?.completed) continue;
    // A lost completion acknowledgement cannot be replayed: Slack accepts completion once.
    if (!file?.uploaded || file.completionStarted) {
      const admission = await getFileUploadUrl(
        id.slice(0, 12) + "-" + name,
        Buffer.byteLength(contents),
      );
      await store.journal(id, {
        provider: "slack",
        operation: "get_upload_url",
        request: { filename: name, length: Buffer.byteLength(contents) },
        response: { fileId: admission.fileId },
      });
      run = await store.update(id, (current) => {
        current.delivery.files[name] = {
          fileId: admission.fileId,
          uploaded: false,
          completed: false,
        };
      });
      await uploadFileBytes(admission.uploadUrl, contents);
      await store.journal(id, {
        provider: "slack",
        operation: "upload_file",
        request: { fileId: admission.fileId, contents },
        response: { uploaded: true },
      });
      run = await store.update(id, (current) => {
        current.delivery.files[name]!.uploaded = true;
      });
      file = run.delivery.files[name];
    }
    if (!file) throw new Error("Upload checkpoint missing");
    const completion = {
      fileId: file.fileId,
      title: name,
      channelId: run.channelId,
      threadTs: run.threadTs,
    };
    await store.update(id, (current) => {
      current.delivery.files[name]!.completionStarted = true;
    });
    try {
      await completeFileUpload(completion);
    } catch (error) {
      if (error instanceof SlackUploadRejected)
        await store.update(id, (current) => {
          current.delivery.files[name]!.completionStarted = false;
        });
      throw error;
    }
    await store.journal(id, {
      provider: "slack",
      operation: "complete_upload",
      request: completion,
      response: { completed: true },
    });
    run = await store.update(id, (current) => {
      current.delivery.files[name]!.completed = true;
      current.delivery.files[name]!.completionStarted = false;
    });
  }
  if (!run.delivery.summarySent) {
    await notifyRun(store, id);
    await store.update(id, (current) => {
      current.delivery.summarySent = true;
      delete current.delivery.error;
    });
  }
}
