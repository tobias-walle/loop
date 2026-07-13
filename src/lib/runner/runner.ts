import type { AgentAdapter, AgentEvent, AgentSession } from "../../agents/types.js";
import { type Logger, noopLogger } from "../logging.js";
import type {
  PipelineState,
  RunResult,
  RunSummary,
  SessionResult,
  Step,
  StepResult,
} from "../types.js";
import { emptyUsage } from "./prompt-builder.js";
import { executeStep } from "./step-executor.js";

export interface RunnerResumeOptions {
  startStepIndex: number;
  previousSummary?: string;
  priorStepResults?: StepResult[];
  priorTotals?: RunSummary;
}

export interface RunnerOptions {
  agent: AgentAdapter;
  agentName?: string;
  projectRoot?: string;
  logger?: Logger;
  onEvent?: (event: AgentEvent, stepIndex: number, executionId: string) => void;
  onStepStart?: (stepIndex: number, step: Step, iteration: number) => void;
  onSessionComplete?: (stepIndex: number, result: SessionResult, executionId: string) => void;
  onStepComplete?: (stepIndex: number, result: StepResult) => void;
  onStepExecutionStart?: (stepIndex: number, step: Step) => void;
  template?: string;
  resume?: RunnerResumeOptions;
}

export interface Runner {
  run(): Promise<RunResult>;
  abort(): void;
  abortAndWait(): Promise<void>;
  getState(): PipelineState;
}

export function createRunner(steps: Step[], opts: RunnerOptions): Runner {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const logger = opts.logger ?? noopLogger;
  let aborted = false;
  let currentSession: AgentSession | null = null;

  const priorTotals = opts.resume?.priorTotals;
  const state: PipelineState = {
    step: opts.resume?.startStepIndex ?? 0,
    totalSteps: steps.length,
    iteration: 1,
    costUsd: priorTotals?.totalCostUsd ?? 0,
    currentSessionCostUsd: 0,
    durationMs: priorTotals?.totalDurationMs ?? 0,
    startTime: Date.now(),
    usage: priorTotals ? { ...priorTotals.totalUsage } : emptyUsage(),
    currentSessionUsage: emptyUsage(),
  };

  logger.info("Runner created", {
    stepCount: steps.length,
    projectRoot,
  });

  return {
    async run(): Promise<RunResult> {
      const stepResults: StepResult[] = [...(opts.resume?.priorStepResults ?? [])];
      const newResults: StepResult[] = [];
      let previousSummary = opts.resume?.previousSummary;
      const startStepIndex = opts.resume?.startStepIndex ?? 0;

      if (startStepIndex < 0 || startStepIndex > steps.length)
        throw new Error(`Invalid resume step index ${startStepIndex}.`);

      logger.info("Run started", { totalSteps: steps.length, startStepIndex });

      for (let i = startStepIndex; i < steps.length; i++) {
        if (aborted) {
          appendSkipped(stepResults, steps, i, "Skipped due to abort", logger);
          break;
        }

        const step = steps[i];
        logger.info("Step execution starting", {
          stepIndex: i,
          stepType: step.type,
          agent: opts.agentName ?? "custom",
          agentArgs: step.args ?? {},
          ...(step.type === "task" ? { task: step.task } : { tasks: step.tasks }),
          ...(step.until != null ? { until: step.until } : {}),
          ...(step.repeat != null ? { repeat: step.repeat } : {}),
          ...(step.max != null ? { max: step.max } : {}),
        });

        const stepStart = Date.now();
        opts.onStepExecutionStart?.(i, step);
        const result = await executeStep(
          {
            agent: opts.agent,
            projectRoot,
            logger,
            steps,
            state,
            isAborted: () => aborted,
            setCurrentSession: (s) => {
              currentSession = s;
            },
            onEvent: opts.onEvent,
            onStepStart: opts.onStepStart,
            onSessionComplete: opts.onSessionComplete,
            onStepComplete: opts.onStepComplete,
            template: opts.template,
          },
          i,
          step,
          previousSummary,
        );
        stepResults.push(result);
        newResults.push(result);

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

      const totalCost =
        (priorTotals?.totalCostUsd ?? 0) +
        newResults.reduce((sum, result) => sum + result.costUsd, 0);
      const totalDuration =
        (priorTotals?.totalDurationMs ?? 0) +
        newResults.reduce((sum, result) => sum + result.durationMs, 0);
      const totalUsage = newResults.reduce(
        (sum, result) => ({
          inputTokens: sum.inputTokens + result.usage.inputTokens,
          outputTokens: sum.outputTokens + result.usage.outputTokens,
          cacheCreationTokens: sum.cacheCreationTokens + result.usage.cacheCreationTokens,
          cacheReadTokens: sum.cacheReadTokens + result.usage.cacheReadTokens,
        }),
        priorTotals ? { ...priorTotals.totalUsage } : emptyUsage(),
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

    async abortAndWait(): Promise<void> {
      logger.warn("Abort and wait called", { hadActiveSession: currentSession != null });
      aborted = true;
      const session = currentSession;
      session?.abort();
      await session?.exited;
      if (currentSession === session) currentSession = null;
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
