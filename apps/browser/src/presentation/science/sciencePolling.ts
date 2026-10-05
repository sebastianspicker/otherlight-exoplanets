/**
 * Polls one loopback V5 job with a finite budget that covers queueing behind
 * other jobs and the service's own wall-time limit once the job is running.
 *
 * The service runs one job at a time with a queue of eight and allows 60 s of
 * wall time from `running`, plus artifact writing. Each job is budgeted 60 s
 * plus a 45 s margin for artifact writing and status latency (105 s). A job may
 * wait for up to eight jobs ahead of it (queue budget 8 x 105 s = 840 s) and
 * then gets 105 s from the first `running` status; the overall bound is
 * 9 x 105 s = 945 s.
 */
import type { ScienceJobStatus } from "../../infrastructure/science";

type SciencePollClient = {
  getJob: (jobId: string, signal?: AbortSignal) => Promise<ScienceJobStatus>;
};

const SCIENCE_JOB_WALL_TIME_MS = 60_000;
const SCIENCE_JOB_MARGIN_MS = 45_000;
const SCIENCE_QUEUE_CAPACITY = 8;
export const SCIENCE_RUNNING_BUDGET_MS = SCIENCE_JOB_WALL_TIME_MS + SCIENCE_JOB_MARGIN_MS;
const SCIENCE_QUEUE_BUDGET_MS = SCIENCE_QUEUE_CAPACITY * SCIENCE_RUNNING_BUDGET_MS;
export const SCIENCE_TOTAL_BUDGET_MS = SCIENCE_QUEUE_BUDGET_MS + SCIENCE_RUNNING_BUDGET_MS;

const FAST_POLL_INTERVAL_MS = 250;
const SLOW_POLL_INTERVAL_MS = 1_000;
const FAST_POLL_WINDOW_MS = 5_000;

/** Either the terminal status, or the phase in which the polling budget ran out. */
export type SciencePollOutcome =
  | { kind: "terminal"; status: ScienceJobStatus }
  | { kind: "budget-exhausted"; phase: "queued" | "running"; budgetMs: number };

function isTerminal(status: ScienceJobStatus): boolean {
  return status.state === "succeeded" || status.state === "failed" || status.state === "cancelled";
}

function abortError(): DOMException {
  return new DOMException("The scientific request was cancelled.", "AbortError");
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function exhaustedBudget(
  startedAt: number,
  runningSince: number | undefined,
  now: number,
): SciencePollOutcome | undefined {
  if (now - startedAt >= SCIENCE_TOTAL_BUDGET_MS) {
    return { kind: "budget-exhausted", phase: "running", budgetMs: SCIENCE_TOTAL_BUDGET_MS };
  }
  if (runningSince !== undefined) {
    return now - runningSince >= SCIENCE_RUNNING_BUDGET_MS
      ? { kind: "budget-exhausted", phase: "running", budgetMs: SCIENCE_RUNNING_BUDGET_MS }
      : undefined;
  }
  return now - startedAt >= SCIENCE_QUEUE_BUDGET_MS
    ? { kind: "budget-exhausted", phase: "queued", budgetMs: SCIENCE_QUEUE_BUDGET_MS }
    : undefined;
}

export async function pollScienceJobWithinBudget(
  client: SciencePollClient,
  jobId: string,
  signal: AbortSignal,
): Promise<SciencePollOutcome> {
  const startedAt = Date.now();
  let runningSince: number | undefined;
  for (;;) {
    if (signal.aborted) throw abortError();
    const status = await client.getJob(jobId, signal);
    if (isTerminal(status)) return { kind: "terminal", status };
    const now = Date.now();
    if (status.state === "running") runningSince ??= now;
    const exhausted = exhaustedBudget(startedAt, runningSince, now);
    if (exhausted) return exhausted;
    await delay(
      now - startedAt < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS,
      signal,
    );
  }
}
