import {
  completeFileUpload,
  getFileUploadUrl,
  postMessage,
  uploadFileBytes,
  SlackUploadRejected,
} from "@/lib/adapters/slack/web-api";
import matter from "gray-matter";
import {
  escapeSlackMrkdwn,
  renderThreadNotice,
} from "@/lib/adapters/slack/blocks";
import { EDITORIAL_BYLINE } from "@/lib/prompts/editorial-producer";
import { pickNoteKey } from "@/lib/trails/note-key";
import { previewHtml, renderPreview, type PreviewDeps } from "./preview";
import { checkZhTw, MARKER, stripMarkers } from "./trail-prose";
import {
  LIMITS,
  TERMINAL,
  type Run,
  type RunStatus,
  type TrailDraft,
} from "./types";
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
        "- Save " +
        run.trail.slug +
        ".mdx as content/trails/" +
        run.trail.slug +
        ".mdx and add heroImage, heroImageAlt, reviewedAt and reviewDueAt; node scripts/checks/trail-frontmatter.mjs names anything missing.\n" +
        "- Review the picks, then place them with npx tsx scripts/trails/apply-picks.ts --trail " +
        run.trail.slug +
        " --picks " +
        run.trail.slug +
        ".picks.json --dry-run, and again without --dry-run.\n" +
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
const PREVIEW = "preview.png";
function shortId(id: string): string {
  return id.slice(0, 8);
}
function usageLine(run: Run): string {
  return (
    "Model usage: US$" +
    run.budget.costUsd.toFixed(2) +
    " of the US$" +
    LIMITS.costUsd +
    " cap." +
    (run.budget.costUncertain
      ? " Additional usage is uncertain; further spending stopped."
      : "")
  );
}
function slackText(text: string): string {
  return escapeSlackMrkdwn(stripMarkers(text));
}
function checksLine(trail: TrailDraft): string {
  const check = checkZhTw(trail);
  if (check.pass) return "zh-TW ✓";
  const terms = check.bannedTerms
    .slice(0, 5)
    .map((hit) => hit.term + "→" + hit.replacement);
  const more = check.bannedTerms.length - terms.length;
  return (
    "⚠ zh-TW check: " +
    Math.round(check.hanShare * 100) +
    "% Han / banned terms: " +
    (terms.join(", ") || "none") +
    (more > 0 ? ", +" + more + " more" : "")
  );
}
const ENDED: Partial<Record<RunStatus, { title: string; sentence: string }>> = {
  ready_for_review: {
    title: "Editorial run finished",
    sentence: "The run finished without a trail draft",
  },
  blocked: {
    title: "Editorial run blocked",
    sentence: "The run stopped before producing a reviewable draft",
  },
  budget_exhausted: {
    title: "Editorial run hit its budget",
    sentence: "The run reached its usage limit before finishing",
  },
  cancelled: {
    title: "Editorial run cancelled",
    sentence: "The run was cancelled",
  },
};

/** The thread notice for a run: the review summary once it has ended. */
function runNotice(run: Run): {
  title: string;
  body: string;
  context: string;
} {
  const context = "Run " + shortId(run.id);
  if (run.status === "awaiting_input")
    return {
      title: "Editorial Producer",
      body: run.question?.text ?? "Reply with your editorial decision.",
      context,
    };
  if (!TERMINAL.has(run.status))
    return {
      title: "Editorial Producer",
      body:
        "Status: " +
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
        " Reply status, resume, cancel, or retry delivery in this thread.",
      context,
    };
  const trail = run.trail;
  if (run.status === "ready_for_review" && trail) {
    const preview = !!run.delivery.files[PREVIEW]?.completed;
    return {
      title: "Editorial draft ready for review",
      body: [
        "*" + slackText(trail.title) + "*",
        slackText(trail.description),
        "",
        "*Sections*",
        ...trail.sections.map(
          (section) =>
            "• " +
            slackText(section.title) +
            " — " +
            section.picks.length +
            (section.picks.length === 1 ? " product" : " products"),
        ),
        "",
        "*Checks:* " + checksLine(trail),
        ...(preview
          ? []
          : [
              "The preview image could not be rendered; read the .mdx file instead.",
            ]),
        usageLine(run),
        "Next: review the " +
          (preview ? "preview and files" : "files") +
          " above. Reply `status`, `cancel`, or `retry delivery` in this thread.",
      ].join("\n"),
      context,
    };
  }
  const ended = ENDED[run.status] ?? {
    title: "Editorial run ended",
    sentence: "The run ended as " + run.status,
  };
  return {
    title: ended.title,
    body:
      ended.sentence +
      (run.error
        ? ": " + escapeSlackMrkdwn(run.error.replace(/\.$/, ""))
        : "") +
      ".\n" +
      usageLine(run) +
      "\nNext: review the files above. Reply `status` or `retry delivery` in this thread.",
    context,
  };
}
export async function notifyRun(store: RunStore, id: string): Promise<void> {
  const run = await store.read(id);
  const notice = renderThreadNotice(runNotice(run));
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

/**
 * Best-effort thread notice that attachment delivery failed. It never throws:
 * callers run it inside their own failure handling.
 */
export async function notifyDeliveryFailure(
  store: RunStore,
  id: string,
  reason: string,
): Promise<void> {
  try {
    const run = await store.read(id);
    const notice = renderThreadNotice({
      title: "Attachment delivery failed",
      body:
        escapeSlackMrkdwn(reason.replace(/\.$/, "")) +
        ". Reply `retry delivery` in this thread to try again.",
      context: "Run " + shortId(id),
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
  } catch (error) {
    console.error(
      "[editorial-producer] failure notice not posted",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export type DeliveryDeps = PreviewDeps;
type Attachment = {
  name: string;
  title: string;
  contents: string | Uint8Array;
};

/**
 * Saves the packet, uploads each file, then completes them in one Slack call so
 * the thread gets a single message with every attachment, followed by the
 * review summary.
 */
export async function deliverRun(
  store: RunStore,
  id: string,
  deps: DeliveryDeps = {},
): Promise<void> {
  let run = await store.read(id);
  const trail = run.trail;
  const base = trail?.slug ?? "editorial-" + shortId(id);
  const files: Attachment[] = trail
    ? [
        { name: "trail.mdx", title: base + ".mdx", contents: trailFile(run) },
        {
          name: "picks.json",
          title: base + ".picks.json",
          contents: trailPicks(run),
        },
      ]
    : [];
  files.push({
    name: "evidence.md",
    title: base + ".evidence.md",
    contents: evidencePacket(run),
  });
  // Once any attachment is in the thread, a late preview would post a second
  // message, so the preview is rendered only while nothing has been completed.
  const fresh = !Object.values(run.delivery.files).some(
    (file) => file.completed,
  );
  if (trail && fresh)
    try {
      files.unshift({
        name: PREVIEW,
        title: base + "-preview.png",
        contents: await renderPreview(previewHtml(run), deps),
      });
    } catch (error) {
      // The preview is a convenience; the summary says when it is missing.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[editorial-producer] preview not rendered", message);
      await store.journal(id, {
        provider: "playwright",
        operation: "render_preview",
        response: { error: message },
      });
    }
  // Save every file before uploading any, so a Slack failure still leaves the
  // complete packet on the volume.
  for (const file of files) await store.artifact(id, file.name, file.contents);
  const pending = files.filter(
    (file) => !run.delivery.files[file.name]?.completed,
  );
  for (const file of pending) {
    const saved = run.delivery.files[file.name];
    // A lost completion acknowledgement cannot be replayed: Slack accepts
    // completion once, so a started completion needs a fresh upload.
    if (saved?.uploaded && !saved.completionStarted) continue;
    const length = Buffer.byteLength(file.contents);
    const admission = await getFileUploadUrl(file.title, length);
    await store.journal(id, {
      provider: "slack",
      operation: "get_upload_url",
      request: { filename: file.title, length },
      response: { fileId: admission.fileId },
    });
    run = await store.update(id, (current) => {
      current.delivery.files[file.name] = {
        fileId: admission.fileId,
        uploaded: false,
        completed: false,
      };
    });
    await uploadFileBytes(admission.uploadUrl, file.contents);
    await store.journal(id, {
      provider: "slack",
      operation: "upload_file",
      request: {
        fileId: admission.fileId,
        ...(typeof file.contents === "string"
          ? { contents: file.contents }
          : { bytes: length }),
      },
      response: { uploaded: true },
    });
    run = await store.update(id, (current) => {
      current.delivery.files[file.name]!.uploaded = true;
    });
  }
  if (pending.length) {
    const completion = {
      files: pending.map((file) => {
        const saved = run.delivery.files[file.name];
        if (!saved) throw new Error("Upload checkpoint missing");
        return { fileId: saved.fileId, title: file.title };
      }),
      channelId: run.channelId,
      threadTs: run.threadTs,
    };
    const mark = (started: boolean) =>
      store.update(id, (current) => {
        for (const file of pending)
          current.delivery.files[file.name]!.completionStarted = started;
      });
    // Every file in the batch shares one completion: if its acknowledgement is
    // lost, all of them are re-uploaded on retry.
    await mark(true);
    try {
      await completeFileUpload(completion);
    } catch (error) {
      if (error instanceof SlackUploadRejected) await mark(false);
      throw error;
    }
    await store.journal(id, {
      provider: "slack",
      operation: "complete_upload",
      request: completion,
      response: { completed: true },
    });
    run = await store.update(id, (current) => {
      for (const file of pending) {
        current.delivery.files[file.name]!.completed = true;
        current.delivery.files[file.name]!.completionStarted = false;
      }
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
