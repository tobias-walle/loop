import * as crypto from "node:crypto";
import { createConfiguredAgent } from "../agents/factory.js";
import { bestEffort } from "../lib/best-effort.js";
import type { LoopRuntimeConfig } from "../lib/config/index.js";
import { createLogger } from "../lib/logging.js";
import type { loadRecipe } from "../lib/recipes/index.js";
import { createRunner } from "../lib/runner.js";
import { createResumableSession } from "../lib/session.js";
import { createEvent, type SessionEvent, type SessionEventType } from "../lib/session-event.js";
import { appendSessionEvent } from "../lib/session-event-store.js";
import {
  acquireSessionLock,
  releaseSessionLock,
  startLockHeartbeat,
  startSessionLockMonitor,
} from "../lib/session-lock.js";
import { loadSession, type SessionRecord, writeSessionProjection } from "../lib/session-store.js";
import type { loadTemplate } from "../lib/template.js";
import type { LoopConfig, Step } from "../lib/types.js";
import type { RunReporter } from "../output/run-reporter.js";

export interface ExecuteSessionOptions {
  config: LoopConfig;
  runtimeConfig: LoopRuntimeConfig;
  template: ReturnType<typeof loadTemplate>;
  loadedRecipe?: ReturnType<typeof loadRecipe>;
  projectRoot: string;
  resumeSession?: SessionRecord;
  reporter: RunReporter;
  signal?: AbortSignal;
}

export async function executeSession(options: ExecuteSessionOptions): Promise<number> {
  const { config, runtimeConfig, template, loadedRecipe, projectRoot, reporter, signal } = options;
  const created = options.resumeSession?.aggregate.invocation
    ? undefined
    : createResumableSession({
        loopVersion: "0.1.0",
        projectRoot,
        steps: config.steps,
        template: {
          source: template.source,
          content: template.template,
          sha256: crypto.createHash("sha256").update(template.template).digest("hex"),
        },
        agent: {
          name: runtimeConfig.agent,
          command: runtimeConfig.agents[runtimeConfig.agent].command,
          model: runtimeConfig.agents[runtimeConfig.agent].model,
          args: runtimeConfig.agents[runtimeConfig.agent].args,
          passthroughArgs: config.passthroughArgs ?? [],
        },
        ...(loadedRecipe ? { recipe: { name: loadedRecipe.name, path: loadedRecipe.path } } : {}),
      });
  const session = options.resumeSession?.aggregate.invocation
    ? {
        sessionDir: options.resumeSession.sessionDir,
        invocation: options.resumeSession.aggregate.invocation,
      }
    : created;
  if (!session) throw new Error("Could not initialize the session.");
  if (created) reportBestEffort(reporter, created.createdEvent);
  else replayPresentation(reporter, options.resumeSession?.events ?? []);

  const lock = acquireSessionLock(session.sessionDir, session.invocation.sessionId);
  const resumed = options.resumeSession ? loadSession(session.sessionDir) : undefined;
  if (resumed && !resumed.aggregate.resumable) {
    releaseSessionLock(session.sessionDir, lock.ownerId);
    throw new Error("This session is no longer resumable.");
  }
  const heartbeat = startLockHeartbeat(session.sessionDir, lock.ownerId);
  const ownership = { ownerId: lock.ownerId, attemptId: lock.attemptId };
  const recordEvent = (event: SessionEvent): void => {
    appendSessionEvent(session.sessionDir, event);
    reportBestEffort(reporter, event);
  };
  const record = <T extends Record<string, unknown>>(type: SessionEventType, data: T): void =>
    recordEvent(createEvent(type, data, ownership));
  const logger = createLogger(
    session.sessionDir,
    ownership,
    reportBestEffort.bind(undefined, reporter),
  );
  let runner: ReturnType<typeof createRunner> | undefined;
  let interrupted = signal?.aborted ?? false;
  let exitCode = 1;
  const startedExecutions = new Set<string>();
  const stepExecutions = new Map<number, string[]>();
  const abort = (): void => {
    interrupted = true;
    runner?.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const lockMonitor = startSessionLockMonitor(session.sessionDir, lock.ownerId, abort);

  try {
    record("attempt_started", {});
    if (interrupted) {
      record("attempt_aborted", {});
      return 130;
    }
    const adapter = createConfiguredAgent({
      selectedAgent: runtimeConfig.agent,
      config: runtimeConfig,
      passthroughArgs: config.passthroughArgs ?? [],
      logger,
    });
    const completedSteps = resumed
      ? [...resumed.aggregate.completedSteps.values()]
          .sort((a, b) => a.stepIndex - b.stepIndex)
          .map((step) => step.result)
      : [];
    runner = createRunner(config.steps, {
      agent: adapter,
      agentName: runtimeConfig.agent,
      projectRoot,
      logger,
      template: template.template,
      ...(resumed
        ? {
            resume: {
              startStepIndex: resumed.aggregate.nextStepIndex,
              previousSummary: resumed.aggregate.previousStepSummary,
              priorStepResults: completedSteps,
              priorTotals: resumed.aggregate.totals,
            },
          }
        : {}),
      onEvent: (event, stepIndex, executionId) => {
        ensureSessionStarted(startedExecutions, executionId, stepIndex, record);
        record("agent_event", { stepIndex, executionId, event });
      },
      onStepExecutionStart: (stepIndex, step) => record("step_started", { stepIndex, step }),
      onStepStart: (stepIndex, step, iteration) =>
        record("step_iteration_started", {
          stepIndex,
          iteration,
          ...(stepMax(step) === undefined ? {} : { max: stepMax(step) }),
        }),
      onSessionComplete: (stepIndex, result, executionId) => {
        ensureSessionStarted(startedExecutions, executionId, stepIndex, record);
        const executionIds = stepExecutions.get(stepIndex) ?? [];
        executionIds.push(executionId);
        stepExecutions.set(stepIndex, executionIds);
        record("agent_usage_updated", {
          executionId,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
          usage: result.usage,
        });
        record(
          result.exitReason === "error" ? "agent_session_cancelled" : "agent_session_completed",
          {
            stepIndex,
            executionId,
            exitReason: result.exitReason,
            iteration: result.iteration,
          },
        );
      },
      onStepComplete: (stepIndex, result) => {
        if (interrupted) record("step_cancelled", { stepIndex, result });
        else if (result.exitReason === "error") record("step_failed", { stepIndex, result });
        else {
          record("step_completed", {
            stepIndex,
            summary: result.result.slice(-500),
            result,
            executionIds: stepExecutions.get(stepIndex) ?? [],
          });
          writeSessionProjection(session.sessionDir, loadSession(session.sessionDir).aggregate);
        }
      },
    });

    const result = await runner.run();
    if (interrupted) await runner.abortAndWait();
    record(
      interrupted ? "attempt_aborted" : result.success ? "attempt_completed" : "attempt_failed",
      {},
    );
    if (result.success && !interrupted) record("run_completed", {});
    exitCode = interrupted ? 130 : result.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await bestEffortAbort(runner);
    bestEffort(
      () => logger.error("Run error", { error: message }),
      () => {},
    );
    bestEffort(
      () => record(interrupted ? "attempt_aborted" : "attempt_failed", { error: message }),
      () => {},
    );
    exitCode = interrupted ? 130 : 1;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (interrupted) await bestEffortAbort(runner);
    bestEffort(
      () => lockMonitor.stop(),
      () => {},
    );
    bestEffort(
      () => heartbeat.stop(),
      () => {},
    );
    bestEffort(
      () => writeSessionProjection(session.sessionDir, loadSession(session.sessionDir).aggregate),
      () => {},
    );
    bestEffort(
      () => releaseSessionLock(session.sessionDir, lock.ownerId),
      () => {},
    );
  }
  return exitCode;
}

function reportBestEffort(reporter: RunReporter, event: SessionEvent | undefined): void {
  if (event)
    bestEffort(
      () => reporter.report(event),
      () => {},
    );
}

function replayPresentation(reporter: RunReporter, events: readonly SessionEvent[]): void {
  if (reporter.replay) {
    bestEffort(
      () => reporter.replay?.(events),
      () => {},
    );
    return;
  }
  for (const event of events) {
    if (event.type === "session_created" || event.type === "agent_usage_updated") {
      reportBestEffort(reporter, event);
    }
  }
}

async function bestEffortAbort(runner: ReturnType<typeof createRunner> | undefined): Promise<void> {
  try {
    await runner?.abortAndWait();
  } catch {}
}

function ensureSessionStarted(
  started: Set<string>,
  executionId: string,
  stepIndex: number,
  record: (type: SessionEventType, data: Record<string, unknown>) => void,
): void {
  if (started.has(executionId)) return;
  started.add(executionId);
  record("agent_session_started", { stepIndex, executionId });
}

function stepMax(step: Step): number | undefined {
  if (step.repeat !== undefined) return step.repeat;
  return step.until !== undefined ? step.max : undefined;
}
