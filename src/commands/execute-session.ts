import * as crypto from "node:crypto";
import * as path from "node:path";
import { createConfiguredAgent } from "../agents/factory.js";
import { bestEffort } from "../lib/best-effort.js";
import type { LoopRuntimeConfig } from "../lib/config/index.js";
import { createLogger } from "../lib/logging.js";
import type { loadRecipe } from "../lib/recipes/index.js";
import { createRunner } from "../lib/runner.js";
import { type SessionEventType, appendSessionEvent, createEvent } from "../lib/session-events.js";
import {
  acquireSessionLock,
  releaseSessionLock,
  startLockHeartbeat,
  startSessionLockMonitor,
} from "../lib/session-lock.js";
import { type SessionRecord, loadSession, writeSessionProjection } from "../lib/session-store.js";
import { createResumableSession } from "../lib/session.js";
import type { loadTemplate } from "../lib/template.js";
import type { LoopConfig } from "../lib/types.js";
import { createLoopTUI } from "../tui/loop-tui.js";
import { describeStep } from "../tui/step-display.js";
import { logSessionSetup, updateSessionDisplay } from "./session-display.js";

export interface ExecuteSessionOptions {
  config: LoopConfig;
  runtimeConfig: LoopRuntimeConfig;
  template: ReturnType<typeof loadTemplate>;
  loadedRecipe?: ReturnType<typeof loadRecipe>;
  projectRoot: string;
  resumeSession?: SessionRecord;
  tui?: ReturnType<typeof createLoopTUI>;
  registerInterrupt?: (handler: () => void) => void;
}

export async function executeSession(options: ExecuteSessionOptions): Promise<number> {
  const { config, runtimeConfig, template, loadedRecipe, projectRoot } = options;
  const session = options.resumeSession?.aggregate.invocation
    ? {
        sessionDir: options.resumeSession.sessionDir,
        invocation: options.resumeSession.aggregate.invocation,
      }
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
  const lock = acquireSessionLock(session.sessionDir, session.invocation.sessionId);
  const resumed = options.resumeSession ? loadSession(session.sessionDir) : undefined;
  if (resumed && !resumed.aggregate.resumable) {
    releaseSessionLock(session.sessionDir, lock.ownerId);
    throw new Error("This session is no longer resumable.");
  }
  const heartbeat = startLockHeartbeat(session.sessionDir, lock.ownerId);
  const ownership = { ownerId: lock.ownerId, attemptId: lock.attemptId };
  const record = <T extends Record<string, unknown>>(type: SessionEventType, data: T): void => {
    appendSessionEvent(session.sessionDir, createEvent(type, data, ownership));
  };
  const logger = createLogger(session.sessionDir, ownership);
  let runner: ReturnType<typeof createRunner> | undefined;
  const startedExecutions = new Set<string>();
  const stepExecutions = new Map<number, string[]>();
  let interrupted = false;
  let tui: ReturnType<typeof createLoopTUI> | undefined = options.tui;
  let exitCode = 1;
  const lockMonitor = startSessionLockMonitor(session.sessionDir, lock.ownerId, () => {
    interrupted = true;
    runner?.abort();
  });

  try {
    record("attempt_started", {});
    const adapter = createConfiguredAgent({
      selectedAgent: runtimeConfig.agent,
      config: runtimeConfig,
      passthroughArgs: config.passthroughArgs ?? [],
      logger,
    });
    logSessionSetup(logger, session.sessionDir, config, runtimeConfig, loadedRecipe);

    tui ??= createLoopTUI({
      onInterrupt: () => {
        interrupted = true;
        runner?.abort();
      },
    });
    if (options.tui) tui.showRunScreen();
    options.registerInterrupt?.(() => {
      interrupted = true;
      runner?.abort();
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
        if (!startedExecutions.has(executionId)) {
          startedExecutions.add(executionId);
          record("agent_session_started", { stepIndex, executionId });
        }
        record("agent_event", { stepIndex, executionId, event });
        tui?.handleEvent(event, stepIndex);
        updateSessionDisplay(tui, runner, stepIndex, config.steps.length);
      },
      onStepExecutionStart: (stepIndex, step) => {
        record("step_started", { stepIndex, step });
      },
      onStepStart: (stepIndex, step, iteration) => {
        const { task, isLoop, max } = describeStep(step);
        record("step_iteration_started", { stepIndex, iteration, max });
        tui?.showStepHeader(
          stepIndex + 1,
          config.steps.length,
          task,
          isLoop ? iteration : undefined,
          max,
          undefined,
          runtimeConfig.agent,
          { ...runtimeConfig.agents[runtimeConfig.agent].args, ...(step.args ?? {}) },
        );
        updateSessionDisplay(
          tui,
          runner,
          stepIndex,
          config.steps.length,
          isLoop ? iteration : undefined,
          max,
        );
      },
      onSessionComplete: (stepIndex, result, executionId) => {
        if (!startedExecutions.has(executionId)) {
          startedExecutions.add(executionId);
          record("agent_session_started", { stepIndex, executionId });
        }
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
        if (result.exitReason !== "error") {
          tui?.showCompletion(
            result.exitReason,
            result.durationMs,
            result.iteration,
            result.costUsd,
            result.usage,
          );
        }
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
        updateSessionDisplay(tui, runner, stepIndex, config.steps.length);
      },
    });

    if (!options.tui) tui.start();
    tui.showSessionInfo(path.basename(session.sessionDir));
    logger.debug("TUI initialized", { source: "loop", type: "tui_started" });

    const result = await runner.run();
    const attemptType = interrupted
      ? "attempt_aborted"
      : result.success
        ? "attempt_completed"
        : "attempt_failed";
    record(attemptType, {});
    if (interrupted) tui.showInterruption();
    if (result.success && !interrupted) record("run_completed", {});
    exitCode = interrupted ? 130 : result.success ? 0 : 1;

    if (!(result.success || interrupted)) {
      const failedStep = result.stepResults.find((item) => item.exitReason === "error");
      logger.warn("Run finished with failure", {
        source: "loop",
        type: "run_failure",
        failedStepError: failedStep?.error,
        failedStepExitReason: failedStep?.exitReason,
      });
      if (failedStep?.error) tui.handleEvent({ type: "error", message: failedStep.error }, 0);
    }
    if (!interrupted) {
      tui.showRunSummary({
        totalCostUsd: result.totalCostUsd,
        totalDurationMs: result.totalDurationMs,
        totalUsage: result.totalUsage,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reportRecoveryError = (operation: string, recoveryError: unknown): void => {
      try {
        logger.warn(`Could not ${operation} while handling run failure`, {
          error: String(recoveryError),
          originalError: message,
        });
      } catch {
        // Recovery failures must not replace the original run error.
      }
    };
    try {
      await runner?.abortAndWait();
    } catch (recoveryError) {
      reportRecoveryError("stop the active agent", recoveryError);
    }
    const attemptType = interrupted ? "attempt_aborted" : "attempt_failed";
    bestEffort(
      () => logger.error("Run error", { source: "loop", type: "run_error", error: message }),
      (recoveryError) => reportRecoveryError("log the run error", recoveryError),
    );
    bestEffort(
      () => record(attemptType, { error: message }),
      (recoveryError) => reportRecoveryError("persist the run error", recoveryError),
    );
    bestEffort(
      () => {
        if (interrupted) tui?.showInterruption();
        else tui?.handleEvent({ type: "error", message }, 0);
      },
      (recoveryError) => reportRecoveryError("display the run error", recoveryError),
    );
    exitCode = interrupted ? 130 : 1;
  } finally {
    const cleanup = (operation: string, action: () => unknown): void =>
      bestEffort(action, (error) => {
        bestEffort(
          () => logger.warn(`Could not ${operation} during cleanup`, { error: String(error) }),
          () => {},
        );
      });
    cleanup("stop the session lock monitor", () => lockMonitor.stop());
    cleanup("stop the session lock heartbeat", () => heartbeat.stop());
    cleanup("stop the TUI", () => tui?.stop());
    cleanup("update the session projection", () =>
      writeSessionProjection(session.sessionDir, loadSession(session.sessionDir).aggregate),
    );
    cleanup("release the session lock", () => releaseSessionLock(session.sessionDir, lock.ownerId));
  }

  return exitCode;
}
