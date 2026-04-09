import type { AgentAdapter, AgentEvent, AgentSession } from "../../agents/types.js";
import { extractExitMarker } from "../exit-marker.js";
import type { Logger } from "../logging.js";
import { loadTemplate } from "../template.js";
import type { PipelineState, Step, StepResult, TokenUsage } from "../types.js";
import { addUsage, buildPrompt, emptyUsage } from "./prompt-builder.js";

export interface StepExecutorContext {
  agent: AgentAdapter;
  projectRoot: string;
  logger: Logger;
  steps: Step[];
  state: PipelineState;
  pendingMessages: string[];
  isAborted: () => boolean;
  getCurrentSession: () => AgentSession | null;
  setCurrentSession: (session: AgentSession | null) => void;
  onEvent?: (event: AgentEvent, stepIndex: number) => void;
  onStepStart?: (stepIndex: number, step: Step, iteration: number) => void;
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

  const template = loadTemplate(ctx.projectRoot);
  const maxIterations = step.until ? (step.max ?? Number.POSITIVE_INFINITY) : (step.repeat ?? 1);

  while (true) {
    if (ctx.isAborted()) {
      exitReason = "error";
      errorMsg = "Aborted";
      break;
    }

    ctx.state.step = stepIndex;
    ctx.state.iteration = iteration;

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

    const session = ctx.agent.spawn(prompt, { cwd: ctx.projectRoot });
    ctx.setCurrentSession(session);
    ctx.logger.info(`${stepLabel} - agent spawned`);

    // Deliver any messages queued before the session started
    for (const msg of ctx.pendingMessages) {
      session.sendMessage(msg);
    }
    ctx.pendingMessages.length = 0;

    const iterResult = await processAgentEvents(ctx, session, stepIndex, stepLabel);

    ctx.setCurrentSession(null);
    totalCost += iterResult.cost;
    totalDuration += iterResult.duration;
    totalUsage = addUsage(totalUsage, iterResult.usage);
    lastResult = iterResult.result;

    ctx.state.costUsd += iterResult.cost;
    ctx.state.durationMs += iterResult.duration;
    ctx.state.usage = addUsage(ctx.state.usage, iterResult.usage);

    if (iterResult.hadError) {
      exitReason = "error";
      errorMsg = iterResult.errorMsg;
      ctx.logger.error(`${stepLabel} - error: ${errorMsg}`);
      break;
    }

    if (ctx.isAborted()) {
      exitReason = "error";
      errorMsg = "Aborted";
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

interface IterationResult {
  result: string;
  cost: number;
  duration: number;
  usage: TokenUsage;
  hadError: boolean;
  errorMsg?: string;
}

async function processAgentEvents(
  ctx: StepExecutorContext,
  session: AgentSession,
  stepIndex: number,
  stepLabel: string,
): Promise<IterationResult> {
  let result = "";
  let cost = 0;
  let duration = 0;
  let usage = emptyUsage();
  let hadError = false;
  let errorMsg: string | undefined;
  let eventCount = 0;

  for await (const event of session.events) {
    eventCount++;
    if (ctx.isAborted()) break;

    ctx.onEvent?.(event, stepIndex);

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
      ctx.logger.info(`${stepLabel} - done (cost=$${cost.toFixed(4)}, ${eventCount} events)`);
    } else if (event.type === "error") {
      hadError = true;
      errorMsg = event.message;
      result = "";
      ctx.logger.error(`${stepLabel} - agent error: ${event.message}`);
    } else if (event.type === "unknown") {
      ctx.logger.warn(
        `${stepLabel} - unknown event "${event.eventType}": ${JSON.stringify(event.raw)}`,
      );
    } else if (event.type === "session_start") {
      ctx.logger.info(`${stepLabel} - session started (model=${event.model})`);
    }
  }

  if (eventCount === 0) {
    ctx.logger.warn(`${stepLabel} - WARNING: agent produced no events`);
  }

  return { result, cost, duration, usage, hadError, errorMsg };
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
    if (marker.type === "loop_done") {
      logger.info(`Step ${stepIndex + 1}/${totalSteps} - iteration ${iteration} - LOOP_DONE`);
      return { exitReason: "loop_done", shouldBreak: true };
    }

    const summary = marker.type === "loop_continue" ? marker.status : result.slice(-500);

    if (iteration >= maxIterations) {
      logger.info(`Step ${stepIndex + 1}/${totalSteps} - iteration ${iteration} - max reached`);
      return { exitReason: "max_reached", shouldBreak: true };
    }

    return { exitReason: "done", shouldBreak: false, previousIterationSummary: summary };
  }

  if (step.repeat) {
    if (iteration >= step.repeat) {
      logger.info(`Step ${stepIndex + 1}/${totalSteps} - iteration ${iteration} - repeat complete`);
      return { exitReason: "done", shouldBreak: true };
    }
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
