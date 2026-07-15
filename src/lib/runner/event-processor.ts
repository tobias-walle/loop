import type { AgentEvent, AgentSession } from "../../agents/types.js";
import type { Logger } from "../logging.js";
import type { TokenUsage } from "../types.js";
import { emptyUsage } from "./prompt-builder.js";

export interface IterationResult {
  result: string;
  cost: number;
  duration: number;
  usage: TokenUsage;
  hadError: boolean;
  errorMsg?: string;
}

export interface EventProcessorContext {
  logger: Logger;
  isAborted: () => boolean;
  onEvent?: (event: AgentEvent, stepIndex: number) => void;
  onUsageDelta?: (costDelta: number, usageDelta: TokenUsage) => void;
}

export async function processAgentEvents(
  ctx: EventProcessorContext,
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

  ctx.logger.debug(`${stepLabel} - waiting for first agent event`);

  for await (const event of normalizeAgentEvents(session)) {
    if (eventCount === 0) {
      ctx.logger.debug(`${stepLabel} - first agent event received`, { eventType: event.type });
    }
    eventCount++;
    if (ctx.isAborted()) break;

    switch (event.type) {
      case "usage_update": {
        const normalizedUsage = normalizeUsage(event.usage);
        const usageDelta = subtractUsage(normalizedUsage, usage);
        const costDelta = event.costUsd - cost;
        cost = event.costUsd;
        usage = normalizedUsage;
        ctx.onUsageDelta?.(costDelta, usageDelta);
        break;
      }
      case "done": {
        result = event.result;
        const normalizedUsage = normalizeUsage(event.usage);
        const usageDelta = subtractUsage(normalizedUsage, usage);
        const costDelta = event.costUsd - cost;
        cost = event.costUsd;
        duration = event.durationMs;
        usage = normalizedUsage;
        ctx.onUsageDelta?.(costDelta, usageDelta);
        break;
      }
      case "error":
        hadError = true;
        errorMsg = event.message;
        result = "";
        break;
    }

    ctx.onEvent?.(event, stepIndex);
    logEvent(ctx.logger, event, stepIndex, stepLabel, eventCount);
  }

  if (eventCount === 0) {
    ctx.logger.warn(`${stepLabel} - WARNING: agent produced no events`);
  }

  return { result, cost, duration, usage, hadError, errorMsg };
}

async function* normalizeAgentEvents(session: AgentSession): AsyncGenerator<AgentEvent> {
  try {
    yield* session.events;
  } catch (error) {
    session.abort();
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

type UsageLike = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
};

function normalizeUsage(usage: UsageLike): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
  };
}

function subtractUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens - b.inputTokens,
    outputTokens: a.outputTokens - b.outputTokens,
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) - (b.cacheCreationTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) - (b.cacheReadTokens ?? 0),
  };
}

function logEvent(
  logger: Logger,
  event: AgentEvent,
  stepIndex: number,
  stepLabel: string,
  eventCount: number,
): void {
  switch (event.type) {
    case "tool_start":
      logger.debug("Tool started", { tool: event.tool, toolId: event.toolId, stepIndex });
      break;
    case "tool_done":
      logger.debug("Tool completed", {
        toolId: event.toolId,
        resultLength: event.result.length,
        stepIndex,
      });
      break;
    case "task_started":
      logger.info("Subagent started", {
        taskId: event.taskId,
        toolUseId: event.toolUseId,
        description: event.description,
        stepIndex,
      });
      break;
    case "task_done":
      logger.info("Subagent completed", {
        taskId: event.taskId,
        status: event.status,
        durationMs: event.durationMs,
        model: event.model,
        totalTokens: event.totalTokens,
        stepIndex,
      });
      break;
    case "retry":
      logger.warn("Agent retry", {
        attempt: event.attempt,
        maxRetries: event.maxRetries,
        delayMs: event.delayMs,
        error: event.error,
        stepIndex,
      });
      break;
    case "rate_limit": {
      const log = event.status === "allowed" ? logger.debug : logger.warn;
      log.call(logger, "Rate limit status", {
        status: event.status,
        resetsAt: event.resetsAt,
        stepIndex,
      });
      break;
    }
    case "usage_update":
      logger.debug("Usage updated", {
        costUsd: event.costUsd,
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        stepIndex,
      });
      break;
    case "done":
      logger.info(`${stepLabel} - done (cost=$${event.costUsd.toFixed(4)}, ${eventCount} events)`);
      break;
    case "error":
      logger.error(`${stepLabel} - agent error: ${event.message}`);
      break;
    case "unknown":
      logger.warn(
        `${stepLabel} - unknown event "${event.eventType}": ${JSON.stringify(event.raw)}`,
      );
      break;
    case "session_start":
      logger.debug(`${stepLabel} - session started (model=${event.model})`);
      break;
  }
}
