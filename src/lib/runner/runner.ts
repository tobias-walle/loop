import type { AgentAdapter, AgentEvent, AgentSession } from "../../agents/types.js";
import { type Logger, noopLogger } from "../logging.js";
import type { PipelineState, RunResult, SessionResult, Step, StepResult } from "../types.js";
import { emptyUsage } from "./prompt-builder.js";
import { executeStep } from "./step-executor.js";

export interface RunnerOptions {
  agent: AgentAdapter;
  projectRoot?: string;
  logger?: Logger;
  onEvent?: (event: AgentEvent, stepIndex: number) => void;
  onStepStart?: (stepIndex: number, step: Step, iteration: number) => void;
  onSessionComplete?: (stepIndex: number, result: SessionResult) => void;
  onStepComplete?: (stepIndex: number, result: StepResult) => void;
}

export interface Runner {
  run(): Promise<RunResult>;
  abort(): void;
  getState(): PipelineState;
  sendMessage(text: string): void;
}

export function createRunner(steps: Step[], opts: RunnerOptions): Runner {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const logger = opts.logger ?? noopLogger;
  let aborted = false;
  let currentSession: AgentSession | null = null;
  const pendingMessages: string[] = [];

  const state: PipelineState = {
    step: 0,
    totalSteps: steps.length,
    iteration: 1,
    costUsd: 0,
    durationMs: 0,
    startTime: Date.now(),
    usage: emptyUsage(),
  };

  logger.info("Runner created", {
    stepCount: steps.length,
    projectRoot,
  });

  return {
    async run(): Promise<RunResult> {
      const stepResults: StepResult[] = [];
      let previousSummary: string | undefined;

      logger.info("Run started", { totalSteps: steps.length });

      for (let i = 0; i < steps.length; i++) {
        if (aborted) {
          appendSkipped(stepResults, steps, i, "Skipped due to abort", logger);
          break;
        }

        const step = steps[i];
        logger.info("Step execution starting", {
          stepIndex: i,
          stepType: step.type,
          ...(step.type === "task" ? { task: step.task } : { tasks: step.tasks }),
          ...(step.until != null ? { until: step.until } : {}),
          ...(step.repeat != null ? { repeat: step.repeat } : {}),
          ...(step.max != null ? { max: step.max } : {}),
        });

        const stepStart = Date.now();
        const result = await executeStep(
          {
            agent: opts.agent,
            projectRoot,
            logger,
            steps,
            state,
            pendingMessages,
            isAborted: () => aborted,
            setCurrentSession: (s) => {
              currentSession = s;
            },
            onEvent: opts.onEvent,
            onStepStart: opts.onStepStart,
            onSessionComplete: opts.onSessionComplete,
            onStepComplete: opts.onStepComplete,
          },
          i,
          step,
          previousSummary,
        );
        stepResults.push(result);

        logger.info("Step execution completed", {
          stepIndex: i,
          exitReason: result.exitReason,
          costUsd: result.costUsd,
          durationMs: Date.now() - stepStart,
          iterations: result.iterations,
        });

        if (result.exitReason === "error") {
          logger.warn("Step errored, skipping remaining steps", {
            stepIndex: i,
            error: result.error ?? "unknown error",
            remainingSteps: steps.length - i - 1,
          });
          appendSkipped(stepResults, steps, i + 1, "Skipped due to previous error", logger);
          break;
        }

        previousSummary = result.result.slice(-500);
      }

      const totalCost = stepResults.reduce((s, r) => s + r.costUsd, 0);
      const totalDuration = stepResults.reduce((s, r) => s + r.durationMs, 0);
      const totalUsage = stepResults.reduce(
        (s, r) => ({
          inputTokens: s.inputTokens + r.usage.inputTokens,
          outputTokens: s.outputTokens + r.usage.outputTokens,
          cacheCreationTokens: s.cacheCreationTokens + r.usage.cacheCreationTokens,
          cacheReadTokens: s.cacheReadTokens + r.usage.cacheReadTokens,
        }),
        emptyUsage(),
      );
      const success = stepResults.every((r) => r.exitReason !== "error");

      logger.info("Run complete", {
        success,
        totalCostUsd: totalCost,
        totalDurationMs: totalDuration,
        totalUsage,
        stepCount: stepResults.length,
      });

      return {
        success,
        totalCostUsd: totalCost,
        totalDurationMs: totalDuration,
        totalUsage,
        stepResults,
      };
    },

    abort(): void {
      logger.warn("Abort called", { hadActiveSession: currentSession != null });
      aborted = true;
      currentSession?.abort();
    },

    sendMessage(text: string): void {
      if (currentSession) {
        logger.debug("Message sent to active session", {
          textLength: text.length,
        });
        currentSession.sendMessage(text);
        opts.onEvent?.({ type: "user_message", text }, state.step);
      } else {
        logger.debug("Message queued (no active session)", {
          textLength: text.length,
          queueSize: pendingMessages.length + 1,
        });
        pendingMessages.push(text);
      }
    },

    getState(): PipelineState {
      return { ...state };
    },
  };
}

function appendSkipped(
  results: StepResult[],
  steps: Step[],
  fromIndex: number,
  error: string,
  logger: Logger,
): void {
  for (let j = fromIndex; j < steps.length; j++) {
    logger.warn("Step skipped", { stepIndex: j, reason: error });
    results.push({
      step: steps[j],
      iterations: 0,
      result: "",
      costUsd: 0,
      durationMs: 0,
      usage: emptyUsage(),
      exitReason: "error",
      error,
    });
  }
}
