import type { AgentAdapter, AgentEvent, AgentSession } from "../../agents/types.js";
import type { Logger } from "../logging.js";
import type { PipelineState, RunResult, Step, StepResult } from "../types.js";
import { emptyUsage } from "./prompt-builder.js";
import { executeStep } from "./step-executor.js";

export interface RunnerOptions {
  agent: AgentAdapter;
  projectRoot?: string;
  logger?: Logger;
  onEvent?: (event: AgentEvent, stepIndex: number) => void;
  onStepStart?: (stepIndex: number, step: Step, iteration: number) => void;
  onStepComplete?: (stepIndex: number, result: StepResult) => void;
}

export interface Runner {
  run(): Promise<RunResult>;
  abort(): void;
  getState(): PipelineState;
  sendMessage(text: string): void;
}

const noopLogger: Logger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  event() {},
};

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

  return {
    async run(): Promise<RunResult> {
      const stepResults: StepResult[] = [];
      let previousSummary: string | undefined;

      for (let i = 0; i < steps.length; i++) {
        if (aborted) {
          appendSkipped(stepResults, steps, i, "Skipped due to abort");
          break;
        }

        const result = await executeStep(
          {
            agent: opts.agent,
            projectRoot,
            logger,
            steps,
            state,
            pendingMessages,
            isAborted: () => aborted,
            getCurrentSession: () => currentSession,
            setCurrentSession: (s) => {
              currentSession = s;
            },
            onEvent: opts.onEvent,
            onStepStart: opts.onStepStart,
            onStepComplete: opts.onStepComplete,
          },
          i,
          steps[i],
          previousSummary,
        );
        stepResults.push(result);

        if (result.exitReason === "error") {
          appendSkipped(stepResults, steps, i + 1, "Skipped due to previous error");
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

      return {
        success,
        totalCostUsd: totalCost,
        totalDurationMs: totalDuration,
        totalUsage,
        stepResults,
      };
    },

    abort(): void {
      aborted = true;
      currentSession?.abort();
    },

    sendMessage(text: string): void {
      if (currentSession) {
        currentSession.sendMessage(text);
      } else {
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
): void {
  for (let j = fromIndex; j < steps.length; j++) {
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
