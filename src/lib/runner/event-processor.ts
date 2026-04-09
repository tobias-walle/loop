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

  for await (const event of session.events) {
    eventCount++;
    if (ctx.isAborted()) break;

    ctx.onEvent?.(event, stepIndex);
    logEvent(ctx.logger, event, stepIndex, stepLabel, eventCount);

    switch (event.type) {
      case "done":
        result = event.result;
        cost = event.costUsd;
        duration = event.durationMs;
        usage = {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cacheCreationTokens: event.usage.cacheCreationTokens ?? 0,
          cacheReadTokens: event.usage.cacheReadTokens ?? 0,
        };
        break;
      case "error":
        hadError = true;
        errorMsg = event.message;
        result = "";
        break;
    }
  }

  if (eventCount === 0) {
    ctx.logger.warn(`${stepLabel} - WARNING: agent produced no events`);
  }

  return { result, cost, duration, usage, hadError, errorMsg };
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
    case "user_message":
      logger.info("User message injected", { textLength: event.text.length, stepIndex });
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
