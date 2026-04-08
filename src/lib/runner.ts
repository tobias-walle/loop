import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentAdapter, AgentEvent, AgentSession } from "../agents/types.js";
import { loadTemplate, renderTemplate } from "./template.js";
import type {
  PipelineState,
  RunResult,
  Step,
  StepResult,
  TemplateContext,
  TokenUsage,
} from "./types.js";

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export interface RunnerOptions {
  agent: AgentAdapter;
  projectRoot?: string;
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

function logToFile(projectRoot: string, message: string): void {
  const logPath = path.join(projectRoot, "loop.log");
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch {
    // If the directory doesn't exist, create it and retry
    try {
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch {
      // Silently ignore log failures (e.g. in tests with temp paths)
    }
  }
}

function extractExitMarker(text: string): {
  type: "loop_done" | "loop_continue" | "none";
  status?: string;
} {
  const trimmed = text.trimEnd();
  const lastLine = trimmed.split("\n").pop()?.trim() ?? "";

  if (lastLine === "LOOP_DONE") {
    return { type: "loop_done" };
  }
  if (lastLine.startsWith("LOOP_CONTINUE:")) {
    const status = lastLine.slice("LOOP_CONTINUE:".length).trim();
    return { type: "loop_continue", status };
  }
  return { type: "none" };
}

function buildPrompt(
  step: Step,
  template: string,
  stepIndex: number,
  totalSteps: number,
  iteration: number,
  previousSummary?: string,
  previousIterationSummary?: string,
): string {
  if (step.type === "task") {
    const context: TemplateContext = {
      task: step.task,
      step: stepIndex + 1,
      totalSteps,
      iteration,
      max: step.max,
      until: step.until,
      repeat: step.repeat,
      previousSummary,
      previousIterationSummary,
    };
    return renderTemplate(template, context);
  }

  // Group step: render each task and join
  const parts: string[] = [];
  for (const task of step.tasks) {
    const context: TemplateContext = {
      task,
      step: stepIndex + 1,
      totalSteps,
      iteration,
      max: step.max,
      until: step.until,
      repeat: step.repeat,
      isGroup: true,
      previousSummary,
      previousIterationSummary,
    };
    parts.push(renderTemplate(template, context));
  }
  return parts.join("\n");
}

export function createRunner(steps: Step[], opts: RunnerOptions): Runner {
  const projectRoot = opts.projectRoot ?? process.cwd();
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

  async function runStep(
    stepIndex: number,
    step: Step,
    previousSummary?: string,
  ): Promise<StepResult> {
    let iteration = 1;
    let previousIterationSummary: string | undefined;
    let lastResult = "";
    let totalCost = 0;
    let totalDuration = 0;
    let totalUsage = emptyUsage();
    let exitReason: StepResult["exitReason"] = "done";
    let errorMsg: string | undefined;

    const template = loadTemplate(projectRoot);

    const maxIterations = step.until ? (step.max ?? Number.POSITIVE_INFINITY) : (step.repeat ?? 1);

    while (true) {
      if (aborted) {
        exitReason = "error";
        errorMsg = "Aborted";
        break;
      }

      state.step = stepIndex;
      state.iteration = iteration;

      const stepLabel = `Step ${stepIndex + 1}/${steps.length} - iteration ${iteration}`;

      logToFile(projectRoot, `${stepLabel} - start`);

      opts.onStepStart?.(stepIndex, step, iteration);

      const prompt = buildPrompt(
        step,
        template,
        stepIndex,
        steps.length,
        iteration,
        previousSummary,
        previousIterationSummary,
      );

      const session = opts.agent.spawn(prompt, { cwd: projectRoot });
      currentSession = session;

      logToFile(projectRoot, `${stepLabel} - agent spawned`);

      // Deliver any messages queued before the session started
      for (const msg of pendingMessages) {
        session.sendMessage(msg);
      }
      pendingMessages.length = 0;

      let result = "";
      let cost = 0;
      let duration = 0;
      let usage = emptyUsage();
      let hadError = false;
      let eventCount = 0;

      for await (const event of session.events) {
        eventCount++;
        if (aborted) break;

        opts.onEvent?.(event, stepIndex);

        if (event.type === "done") {
          result = event.result;
          cost = event.costUsd;
          duration = event.durationMs;
          usage = {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheCreationTokens: event.usage.cacheCreationTokens ?? 0,
            cacheReadTokens: event.usage.cacheReadTokens ?? 0,
          };
          logToFile(
            projectRoot,
            `${stepLabel} - done (cost=$${cost.toFixed(4)}, ${eventCount} events)`,
          );
        } else if (event.type === "error") {
          hadError = true;
          errorMsg = event.message;
          result = "";
          logToFile(projectRoot, `${stepLabel} - agent error: ${event.message}`);
        } else if (event.type === "unknown") {
          logToFile(
            projectRoot,
            `${stepLabel} - unknown event "${event.eventType}": ${JSON.stringify(event.raw)}`,
          );
        } else if (event.type === "session_start") {
          logToFile(projectRoot, `${stepLabel} - session started (model=${event.model})`);
        }
      }

      if (eventCount === 0) {
        logToFile(projectRoot, `${stepLabel} - WARNING: agent produced no events`);
      }

      currentSession = null;
      totalCost += cost;
      totalDuration += duration;
      totalUsage = addUsage(totalUsage, usage);
      lastResult = result;

      state.costUsd += cost;
      state.durationMs += duration;
      state.usage = addUsage(state.usage, usage);

      if (hadError) {
        exitReason = "error";
        logToFile(
          projectRoot,
          `Step ${stepIndex + 1}/${steps.length} - iteration ${iteration} - error: ${errorMsg}`,
        );
        break;
      }

      if (aborted) {
        exitReason = "error";
        errorMsg = "Aborted";
        break;
      }

      // Check loop termination
      if (step.until) {
        const marker = extractExitMarker(result);
        if (marker.type === "loop_done") {
          exitReason = "loop_done";
          logToFile(
            projectRoot,
            `Step ${stepIndex + 1}/${steps.length} - iteration ${iteration} - LOOP_DONE`,
          );
          break;
        }

        // LOOP_CONTINUE or no marker - keep going
        if (marker.type === "loop_continue") {
          previousIterationSummary = marker.status;
        } else {
          // No marker found - treat as continue, use last 500 chars as summary
          previousIterationSummary = result.slice(-500);
        }

        if (iteration >= maxIterations) {
          exitReason = "max_reached";
          logToFile(
            projectRoot,
            `Step ${stepIndex + 1}/${steps.length} - iteration ${iteration} - max reached`,
          );
          break;
        }

        iteration++;
      } else if (step.repeat) {
        if (iteration >= step.repeat) {
          exitReason = "done";
          logToFile(
            projectRoot,
            `Step ${stepIndex + 1}/${steps.length} - iteration ${iteration} - repeat complete`,
          );
          break;
        }
        previousIterationSummary = result.slice(-500);
        iteration++;
      } else {
        // Plain step, run once
        logToFile(projectRoot, `Step ${stepIndex + 1}/${steps.length} - completed`);
        break;
      }
    }

    const stepResult: StepResult = {
      step,
      iterations: iteration,
      result: lastResult,
      costUsd: totalCost,
      durationMs: totalDuration,
      usage: totalUsage,
      exitReason,
      error: errorMsg,
    };

    opts.onStepComplete?.(stepIndex, stepResult);
    return stepResult;
  }

  return {
    async run(): Promise<RunResult> {
      const stepResults: StepResult[] = [];
      let previousSummary: string | undefined;

      for (let i = 0; i < steps.length; i++) {
        if (aborted) {
          // Mark remaining steps as skipped
          for (let j = i; j < steps.length; j++) {
            stepResults.push({
              step: steps[j],
              iterations: 0,
              result: "",
              costUsd: 0,
              durationMs: 0,
              usage: emptyUsage(),
              exitReason: "error",
              error: "Skipped due to abort",
            });
          }
          break;
        }

        const result = await runStep(i, steps[i], previousSummary);
        stepResults.push(result);

        if (result.exitReason === "error") {
          // Mark remaining steps as skipped
          for (let j = i + 1; j < steps.length; j++) {
            stepResults.push({
              step: steps[j],
              iterations: 0,
              result: "",
              costUsd: 0,
              durationMs: 0,
              usage: emptyUsage(),
              exitReason: "error",
              error: "Skipped due to previous error",
            });
          }
          break;
        }

        // Pass summary of last 500 chars to next step
        previousSummary = result.result.slice(-500);
      }

      const totalCost = stepResults.reduce((s, r) => s + r.costUsd, 0);
      const totalDuration = stepResults.reduce((s, r) => s + r.durationMs, 0);
      const totalUsage = stepResults.reduce((s, r) => addUsage(s, r.usage), emptyUsage());
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
