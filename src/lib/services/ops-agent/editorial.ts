import { createHash } from "node:crypto";
import { commandEditorialProducer } from "@/lib/adapters/editorial-producer";
import { getEditorialThreadRequest } from "./requests";
import type { OpsRequestRow } from "./types";
import type { CommandInput } from "../editorial-producer/types";

export const EDITORIAL_ROUTING_RULE =
  "For a HUMAN request to research, prepare, write or draft a Formoria article, call propose_action with kind start_editorial_producer and brief preserving the actual request. It displays a Start button before research begins. NEVER fire_routine for editorial articles. Do not research or draft inside Ops. Final selection and publication are human-owned.";

/** Ops offers and relays editorial runs only once the worker is configured. */
export function editorialProducerConfigured(): boolean {
  return (
    !!process.env.EDITORIAL_PRODUCER_URL &&
    !!process.env.EDITORIAL_PRODUCER_TOKEN
  );
}

export async function relayEditorialReply(
  request: OpsRequestRow,
): Promise<string | null> {
  if (!editorialProducerConfigured()) return null;
  const original = await getEditorialThreadRequest(
    request.channelId,
    request.threadTs,
  );
  if (!original) return null;
  if (original.slackUserId !== request.slackUserId)
    return "Only the operator who initiated this editorial run may answer or control it.";
  const result = original.result as { editorialRunId?: string } | null;
  const runId =
    result?.editorialRunId ??
    createHash("sha256").update(original.id).digest("hex");
  const owner = {
    runId,
    operatorSlackId: request.slackUserId,
    channelId: request.channelId,
    threadTs: request.threadTs,
    eventId: request.slackEventId ?? request.id,
  };
  const text = request.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  const commands: Record<string, CommandInput["command"]> = {
    status: "status",
    resume: "resume",
    cancel: "cancel",
    "retry delivery": "retry_delivery",
  };
  const command = commands[text.toLowerCase()];
  const status = await commandEditorialProducer({
    ...owner,
    command: "status",
  });
  if (!status.ok && status.error === "Run not found") return null;
  if (!status.ok)
    return "Cannot reach the saved editorial run: " + status.error;
  const unfinished = ["running", "interrupted", "awaiting_input"].includes(
    status.status,
  );
  if (!command && !unfinished) return null;
  if (!command && status.status !== "awaiting_input")
    return (
      "This editorial run is " +
      status.status +
      ". A new run cannot start until it finishes or you cancel it. Reply status, resume, or cancel."
    );
  const answer = command ? undefined : text.replace(/^answer\s+/i, "");
  const response =
    command === "status"
      ? status
      : await commandEditorialProducer({
          ...owner,
          command: command ?? "answer",
          ...(answer ? { answer } : {}),
        });
  if (!response.ok)
    return response.error === "Delivery is already in progress"
      ? "Attachments are already being delivered; they will appear in this thread shortly."
      : response.error;
  if (command === "retry_delivery")
    return "Re-sending the attachments; they will appear in this thread shortly.";
  return (
    "Editorial Producer: " +
    response.status +
    " (" +
    response.stage +
    "). Model usage US$" +
    response.costUsd.toFixed(4) +
    " / US$1." +
    (response.costUncertain
      ? " Additional usage is uncertain; further spending stopped."
      : "") +
    (response.question ? "\n" + response.question.text : "") +
    (response.deliveryError
      ? "\nAttachment delivery failed; reply retry delivery."
      : "")
  );
}
