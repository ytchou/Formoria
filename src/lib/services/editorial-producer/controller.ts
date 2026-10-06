import {
  deliverRun,
  notifyDeliveryFailure,
  notifyRun,
  type DeliveryDeps,
} from "./delivery";
import { runProducer } from "./run";
import { RunStore } from "./store";
import {
  ownsRun,
  TERMINAL,
  type CommandInput,
  type Run,
  type StartInput,
} from "./types";

export function runSummary(run: Run) {
  return {
    runId: run.id,
    status: run.status,
    stage: run.stage,
    question: run.question,
    costUsd: run.budget.costUsd,
    costUncertain: run.budget.costUncertain,
    activeMs: run.budget.activeMs,
    deliveryError: run.delivery.error ?? null,
  };
}
export class ProducerController {
  private deliveries = new Map<string, Promise<void>>();
  private tasks = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  constructor(
    readonly store: RunStore,
    private readonly deps: DeliveryDeps = {},
  ) {}
  private launch(id: string) {
    if (this.tasks.has(id)) return;
    const abort = new AbortController();
    const promise = (async () => {
      let delivering = false;
      try {
        const run = await runProducer(this.store, id, abort.signal);
        delivering = TERMINAL.has(run.status);
        if (delivering) await deliverRun(this.store, id, this.deps);
        else await notifyRun(this.store, id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.update(id, (run) => {
          run.delivery.error = message;
        });
        if (delivering) await notifyDeliveryFailure(this.store, id, message);
      }
    })()
      .catch((error) => {
        console.error(
          "[editorial-producer] checkpoint failure",
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.tasks.delete(id);
      });
    this.tasks.set(id, { abort, promise });
  }
  /**
   * Redelivers in the background: uploads take several seconds per file, longer
   * than the caller's request timeout, and a timed-out caller retries.
   */
  private redeliver(id: string) {
    const promise = (async () => {
      try {
        await deliverRun(this.store, id, this.deps);
        await this.store.update(id, (current) => {
          delete current.delivery.error;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.update(id, (current) => {
          current.delivery.error = message;
        });
        await notifyDeliveryFailure(this.store, id, message);
      }
    })()
      .catch((error) => {
        console.error(
          "[editorial-producer] checkpoint failure",
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.deliveries.delete(id);
      });
    this.deliveries.set(id, promise);
  }
  async start(input: StartInput) {
    const result = await this.store.start(input);
    if (!result.accepted)
      return { accepted: false, duplicate: false, status: result.run.status };
    if (result.accepted && !result.duplicate) this.launch(result.run.id);
    return {
      accepted: result.accepted,
      duplicate: result.duplicate ?? false,
      ...runSummary(result.run),
    };
  }
  async command(input: CommandInput) {
    const run = await this.store.read(input.runId);
    if (!ownsRun(run, input))
      throw new Error(
        "Only the originating operator and thread may control this run",
      );
    if (input.command === "status") return runSummary(run);
    if (run.processedEvents.includes(input.eventId)) return runSummary(run);
    if (input.command === "cancel") {
      if (!TERMINAL.has(run.status)) {
        const task = this.tasks.get(run.id);
        if (task) {
          task.abort.abort("cancelled_by_operator");
          await task.promise;
        }
        await this.store.update(run.id, (current) => {
          current.status = "cancelled";
          current.question = null;
          current.processedEvents.push(input.eventId);
        });
      }
    } else if (input.command === "retry_delivery") {
      if (!TERMINAL.has(run.status))
        throw new Error(
          "Finish or cancel the run before retrying its final attachments",
        );
      if (this.tasks.has(run.id) || this.deliveries.has(run.id))
        throw new Error("Delivery is already in progress");
      this.redeliver(run.id);
      // Serialised store writes put this before any failure the retry records.
      await this.store.update(run.id, (current) => {
        current.processedEvents.push(input.eventId);
        delete current.delivery.error;
      });
    } else {
      if (this.tasks.has(run.id)) throw new Error("Run is already processing");
      if (
        input.command === "answer" &&
        (run.status !== "awaiting_input" ||
          !run.question ||
          !input.answer?.trim())
      )
        throw new Error("There is no pending question or the answer is empty");
      if (input.command === "resume" && run.status !== "interrupted")
        throw new Error(
          "Only interrupted runs can resume; awaiting runs need an answer",
        );
      await this.store.update(run.id, (current) => {
        if (
          current.status !== run.status ||
          current.processedEvents.includes(input.eventId)
        )
          throw new Error("Stale or duplicate run command");
        if (input.command === "answer" && current.question && input.answer)
          current.answers.push({
            questionId: current.question.id,
            questionText: current.question.text,
            text: input.answer,
            eventId: input.eventId,
          });
        current.question = null;
        current.status = "running";
        current.processedEvents.push(input.eventId);
        delete current.error;
      });
      this.launch(run.id);
    }
    return runSummary(await this.store.read(run.id));
  }
  async shutdown(): Promise<void> {
    const tasks = [...this.tasks.values()];
    tasks.forEach((task) => task.abort.abort("worker_shutdown"));
    await Promise.all([
      ...tasks.map((task) => task.promise),
      ...this.deliveries.values(),
    ]);
  }
}
