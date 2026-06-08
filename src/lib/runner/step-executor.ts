import type { AgentAdapter, AgentEvent, AgentSession } from "../../agents/types.js";
import { extractExitMarker } from "../exit-marker.js";
import type { Logger } from "../logging.js";
import { loadTemplate } from "../template.js";
import type { PipelineState, SessionResult, Step, StepResult } from "../types.js";
import { type IterationResult, processAgentEvents } from "./event-processor.js";
import { addUsage, buildPrompt, emptyUsage } from "./prompt-builder.js";

export interface StepExecutorContext {
  agent: AgentAdapter;
  projectRoot: string;
  logger: Logger;
  steps: Step[];
  state: PipelineState;
  pendingMessages: string[];
  isAborted: () => boolean;
  setCurrentSession: (session: AgentSession | null) => void;
  onEvent?: (event: AgentEvent, stepIndex: number) => void;
  onStepStart?: (stepIndex: number, step: Step, iteration: number) => void;
  onSessionComplete?: (stepIndex: number, result: SessionResult) => void;
  onStepComplete?: (stepIndex: number, result: StepResult) => void;
}

export async function executeStep(
  ctx: StepExecutorContext,
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

  const { template, source: templateSource } = loadTemplate(ctx.projectRoot);
  ctx.logger.debug("Template loaded", { templateSource, projectRoot: ctx.projectRoot });

  const maxIterations = step.until ? (step.max ?? Number.POSITIVE_INFINITY) : (step.repeat ?? 1);
  ctx.logger.debug("Computed maxIterations", {
    maxIterations: maxIterations === Number.POSITIVE_INFINITY ? "Infinity" : maxIterations,
    mode: step.until ? "until" : "repeat",
    until: step.until,
    repeat: step.repeat,
    max: step.max,
  });

  while (true) {
    if (ctx.isAborted()) {
      ctx.logger.warn("Abort detected before iteration start", { stepIndex, iteration });
      exitReason = "error";
      errorMsg = "Aborted";
      break;
    }

    ctx.state.step = stepIndex;
    ctx.state.iteration = iteration;
    ctx.state.currentSessionCostUsd = 0;
    ctx.state.currentSessionUsage = emptyUsage();

    const stepLabel = `Step ${stepIndex + 1}/${ctx.steps.length} - iteration ${iteration}`;
    ctx.logger.info(`${stepLabel} - start`);
    ctx.onStepStart?.(stepIndex, step, iteration);

    const prompt = buildPrompt(
      step,
      template,
      stepIndex,
      ctx.steps.length,
      iteration,
      previousSummary,
      previousIterationSummary,
    );

    ctx.logger.debug("Prompt built", { promptLength: prompt.length, stepIndex, iteration });

    const session = ctx.agent.spawn(prompt, { cwd: ctx.projectRoot });
    ctx.setCurrentSession(session);
    ctx.logger.info(`${stepLabel} - agent spawned`);

    if (ctx.pendingMessages.length > 0) {
      ctx.logger.debug("Delivering pending messages", {
        count: ctx.pendingMessages.length,
        stepIndex,
        iteration,
      });
    }
    for (const msg of ctx.pendingMessages) {
      session.sendMessage(msg);
      ctx.onEvent?.({ type: "user_message", text: msg }, stepIndex);
    }
    ctx.pendingMessages.length = 0;

    const iterResult = await processAgentEvents(
      {
        ...ctx,
        onUsageDelta(costDelta, usageDelta) {
          ctx.state.costUsd += costDelta;
          ctx.state.currentSessionCostUsd += costDelta;
          ctx.state.usage = addUsage(ctx.state.usage, usageDelta);
          ctx.state.currentSessionUsage = addUsage(ctx.state.currentSessionUsage, usageDelta);
        },
      },
      session,
      stepIndex,
      stepLabel,
    );

    // Wait for the process to fully exit before continuing, so the next
    // iteration doesn't race with a still-shutting-down process (e.g. Claude
    // Code session locks).
    await session.exited;

    ctx.setCurrentSession(null);
    totalCost += iterResult.cost;
    totalDuration += iterResult.duration;
    totalUsage = addUsage(totalUsage, iterResult.usage);
    lastResult = iterResult.result;

    ctx.state.durationMs += iterResult.duration;

    if (iterResult.hadError) {
      exitReason = "error";
      errorMsg = iterResult.errorMsg;
      ctx.logger.error(`${stepLabel} - error: ${errorMsg}`);
      emitSessionComplete(ctx, stepIndex, iteration, iterResult, exitReason, errorMsg);
      break;
    }

    if (ctx.isAborted()) {
      ctx.logger.warn("Abort detected after iteration", { stepIndex, iteration });
      exitReason = "error";
      errorMsg = "Aborted";
      emitSessionComplete(ctx, stepIndex, iteration, iterResult, exitReason, errorMsg);
      break;
    }

    const loopResult = evaluateLoopExit(
      step,
      iterResult.result,
      iteration,
      maxIterations,
      ctx.logger,
      stepIndex,
      ctx.steps.length,
    );

    exitReason = loopResult.exitReason;
    emitSessionComplete(ctx, stepIndex, iteration, iterResult, exitReason);
    if (loopResult.shouldBreak) break;
    previousIterationSummary = loopResult.previousIterationSummary;
    iteration++;
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

  ctx.onStepComplete?.(stepIndex, stepResult);
  return stepResult;
}

function emitSessionComplete(
  ctx: StepExecutorContext,
  stepIndex: number,
  iteration: number,
  iterResult: IterationResult,
  exitReason: StepResult["exitReason"],
  error?: string,
): void {
  ctx.onSessionComplete?.(stepIndex, {
    iteration,
    result: iterResult.result,
    costUsd: iterResult.cost,
    durationMs: iterResult.duration,
    usage: iterResult.usage,
    exitReason,
    error,
  });
}

interface LoopEvaluation {
  exitReason: StepResult["exitReason"];
  shouldBreak: boolean;
  previousIterationSummary?: string;
}

function evaluateLoopExit(
  step: Step,
  result: string,
  iteration: number,
  maxIterations: number,
  logger: Logger,
  stepIndex: number,
  totalSteps: number,
): LoopEvaluation {
  if (step.until) {
    const marker = extractExitMarker(result);
    logger.debug("Exit marker extracted", { markerType: marker.type, stepIndex, iteration });
    if (marker.type === "loop_done") {
      logger.info(`Step ${stepIndex + 1}/${totalSteps} - iteration ${iteration} - LOOP_DONE`);
      return { exitReason: "loop_done", shouldBreak: true };
    }

    const summary = marker.type === "loop_continue" ? marker.status : result.slice(-500);

    if (iteration >= maxIterations) {
      logger.info(`Step ${stepIndex + 1}/${totalSteps} - iteration ${iteration} - max reached`);
      return { exitReason: "max_reached", shouldBreak: true };
    }

    logger.debug("Continuing loop (until mode)", {
      iteration,
      summaryLength: summary?.length ?? 0,
      resultLength: result.length,
    });
    return { exitReason: "done", shouldBreak: false, previousIterationSummary: summary };
  }

  if (step.repeat) {
    if (iteration >= step.repeat) {
      logger.info(`Step ${stepIndex + 1}/${totalSteps} - iteration ${iteration} - repeat complete`);
      return { exitReason: "done", shouldBreak: true };
    }
    logger.debug("Continuing loop (repeat mode)", {
      iteration,
      resultLength: result.length,
    });
    return {
      exitReason: "done",
      shouldBreak: false,
      previousIterationSummary: result.slice(-500),
    };
  }

  // Plain step, run once
  logger.info(`Step ${stepIndex + 1}/${totalSteps} - completed`);
  return { exitReason: "done", shouldBreak: true };
}
