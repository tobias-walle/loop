import type { AgentEvent, TokenUsage } from "../types.js";
import { formatMessageEndError } from "./error-format.js";
import { arrayOfStrings, isRecord, numberAt, recordAt, stringAt } from "./object.js";
import {
  addUsage,
  extractRunCost,
  extractRunUsage,
  hasRunCost,
  hasRunUsage,
  usageFromRaw,
  zeroUsage,
} from "./usage.js";

export type PiEventState = {
  text: string;
  sessionStarted: boolean;
  model?: string;
  sessionId: string;
  cwd?: string;
  sessionVersion?: number;
  tools: string[];
  cumulativeCostUsd: number;
  cumulativeUsage: TokenUsage;
  pendingDone?: PendingPiDone;
};

type PendingPiDone = {
  result: string;
  durationMs: number;
  fallbackCostUsd: number;
  fallbackUsage: TokenUsage;
};

export function createPiEventState(): PiEventState {
  return {
    text: "",
    sessionStarted: false,
    sessionId: "pi-json",
    tools: [],
    cumulativeCostUsd: 0,
    cumulativeUsage: zeroUsage(),
  };
}

export function mapPiEvent(raw: unknown, state: PiEventState): AgentEvent[] {
  if (!isRecord(raw) || typeof raw.type !== "string") return [];
  const type = raw.type;
  switch (type) {
    case "session":
      state.sessionId = stringAt(raw, ["id"]) ?? state.sessionId;
      state.cwd = stringAt(raw, ["cwd"]) ?? state.cwd;
      state.sessionVersion = numberAt(raw, ["version"]) ?? state.sessionVersion;
      return [];
    case "agent_start": {
      const model = stringAt(raw, ["model"]) ?? stringAt(raw, ["agent", "model"]) ?? "pi";
      const sessionId =
        stringAt(raw, ["sessionId"]) ?? stringAt(raw, ["session", "id"]) ?? state.sessionId;
      const tools = arrayOfStrings(raw.tools);
      state.sessionStarted = true;
      state.model = model;
      state.sessionId = sessionId;
      state.tools = tools;
      return [{ type: "session_start", model, sessionId, tools }];
    }
    case "message_start":
      return mapMessageStart(raw, state);
    case "response":
      if (isSessionStatsResponse(raw)) {
        if (state.pendingDone && isFinalStatsResponse(raw)) {
          return [
            completePendingDone(state, raw.success === true ? recordAt(raw, ["data"]) : undefined),
          ];
        }
        if (raw.success === true) return mapUsageUpdate(raw);
        return [];
      }
      if (raw.success === false) {
        return [{ type: "error", message: stringAt(raw, ["error"]) ?? "pi command failed" }];
      }
      return [];
    case "message_update":
      return mapMessageUpdate(raw, state);
    case "tool_execution_start":
      return [
        {
          type: "tool_start",
          toolId: stringAt(raw, ["toolCallId"]) ?? stringAt(raw, ["tool_call_id"]) ?? "unknown",
          tool: stringAt(raw, ["toolName"]) ?? stringAt(raw, ["tool_name"]) ?? "unknown",
          input: recordAt(raw, ["args"]) ?? {},
          parentToolUseId: null,
        },
      ];
    case "tool_execution_end":
      return [
        {
          type: "tool_done",
          toolId: stringAt(raw, ["toolCallId"]) ?? stringAt(raw, ["tool_call_id"]) ?? "unknown",
          result: stringifyResult(raw.result),
          parentToolUseId: null,
        },
      ];
    case "auto_retry_start":
      return [
        {
          type: "retry",
          attempt: numberAt(raw, ["attempt"]) ?? 0,
          maxRetries: numberAt(raw, ["maxRetries"]) ?? numberAt(raw, ["max_retries"]) ?? 0,
          delayMs: numberAt(raw, ["delayMs"]) ?? numberAt(raw, ["delay_ms"]) ?? 0,
          error: stringAt(raw, ["error"]) ?? "retrying",
        },
      ];
    case "message_end": {
      const stopReason =
        stringAt(raw, ["assistant", "stopReason"]) ?? stringAt(raw, ["message", "stopReason"]);
      if (stopReason === "error") return [{ type: "error", message: formatMessageEndError(raw) }];
      return [];
    }
    case "turn_end":
      return mapTurnEnd(raw, state);
    case "agent_settled":
      return state.pendingDone ? [completePendingDone(state)] : [];
    case "turn_start":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_end":
      return [];
    case "extension_error":
      return [{ type: "error", message: stringAt(raw, ["message"]) ?? "pi extension error" }];
    case "agent_end":
      state.pendingDone = createPendingDone(raw, state);
      return [];
    default:
      return [{ type: "unknown", eventType: type, raw }];
  }
}

function mapTurnEnd(raw: Record<string, unknown>, state: PiEventState): AgentEvent[] {
  const message = recordAt(raw, ["message"]);
  const usage = recordAt(message, ["usage"]);
  if (!usage) return [];
  state.cumulativeUsage = addUsage(state.cumulativeUsage, usageFromRaw(usage));
  state.cumulativeCostUsd += numberAt(usage, ["cost", "total"]) ?? 0;
  return [
    {
      type: "usage_update",
      costUsd: state.cumulativeCostUsd,
      usage: state.cumulativeUsage,
    },
  ];
}

function mapMessageStart(raw: Record<string, unknown>, state: PiEventState): AgentEvent[] {
  const model = stringAt(raw, ["message", "model"]) ?? stringAt(raw, ["model"]);
  if (!model || model === state.model) return [];
  state.sessionStarted = true;
  state.model = model;
  return [{ type: "session_start", model, sessionId: state.sessionId, tools: state.tools }];
}

function mapMessageUpdate(raw: Record<string, unknown>, state: PiEventState): AgentEvent[] {
  const assistant =
    recordAt(raw, ["assistantMessageEvent"]) ?? recordAt(raw, ["event", "assistantMessageEvent"]);
  const kind = stringAt(assistant, ["type"]);
  if (kind === "text_delta") {
    const text = stringAt(assistant, ["text"]) ?? stringAt(assistant, ["delta"]) ?? "";
    state.text += text;
    return [{ type: "text_delta", text, parentToolUseId: null }];
  }
  if (kind === "text_end") {
    const text = stringAt(assistant, ["text"]) ?? stringAt(assistant, ["content"]) ?? state.text;
    return [{ type: "text_done", text, parentToolUseId: null }];
  }
  return [];
}

export function completePendingDone(
  state: PiEventState,
  stats?: Record<string, unknown>,
): AgentEvent {
  const pending = state.pendingDone;
  state.pendingDone = undefined;
  if (!pending) {
    return { type: "done", result: state.text, costUsd: 0, durationMs: 0, usage: zeroUsage() };
  }

  const tokens = recordAt(stats, ["tokens"]);
  const usage = tokens
    ? {
        inputTokens: numberAt(tokens, ["input"]) ?? 0,
        outputTokens: numberAt(tokens, ["output"]) ?? 0,
        cacheCreationTokens: numberAt(tokens, ["cacheWrite"]) ?? 0,
        cacheReadTokens: numberAt(tokens, ["cacheRead"]) ?? 0,
      }
    : pending.fallbackUsage;
  const costUsd = numberAt(stats, ["cost"]) ?? pending.fallbackCostUsd;
  return { type: "done", result: pending.result, costUsd, durationMs: pending.durationMs, usage };
}

function createPendingDone(raw: Record<string, unknown>, state: PiEventState): PendingPiDone {
  const finalMessage = extractFinalAssistantMessage(raw);
  const result = extractFinalText(raw, finalMessage) ?? state.text;
  const fallbackUsage = hasRunUsage(raw) ? extractRunUsage(raw) : state.cumulativeUsage;
  const fallbackCostUsd = hasRunCost(raw) ? extractRunCost(raw) : state.cumulativeCostUsd;
  const durationMs = numberAt(raw, ["durationMs"]) ?? numberAt(raw, ["duration_ms"]) ?? 0;
  return { result, durationMs, fallbackUsage, fallbackCostUsd };
}

function isSessionStatsResponse(raw: Record<string, unknown>): boolean {
  return stringAt(raw, ["command"]) === "get_session_stats";
}

function isFinalStatsResponse(raw: Record<string, unknown>): boolean {
  return stringAt(raw, ["id"]) === "loop-final-stats";
}

function mapUsageUpdate(raw: Record<string, unknown>): AgentEvent[] {
  const stats = recordAt(raw, ["data"]);
  const tokens = recordAt(stats, ["tokens"]);
  if (!tokens) return [];
  return [
    {
      type: "usage_update",
      costUsd: numberAt(stats, ["cost"]) ?? 0,
      usage: {
        inputTokens: numberAt(tokens, ["input"]) ?? 0,
        outputTokens: numberAt(tokens, ["output"]) ?? 0,
        cacheCreationTokens: numberAt(tokens, ["cacheWrite"]) ?? 0,
        cacheReadTokens: numberAt(tokens, ["cacheRead"]) ?? 0,
      },
    },
  ];
}

function extractFinalText(
  raw: Record<string, unknown>,
  finalMessage?: Record<string, unknown>,
): string | undefined {
  const text = stringAt(raw, ["result"]) ?? stringAt(raw, ["text"]);
  if (text) return text;
  return finalMessage ? extractContentText(finalMessage.content) : undefined;
}

function extractFinalAssistantMessage(
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const messages = Array.isArray(raw.messages) ? raw.messages : undefined;
  const last = messages?.findLast((message) => isRecord(message) && message.role === "assistant");
  return isRecord(last) ? last : undefined;
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part) => (isRecord(part) ? stringAt(part, ["text"]) : undefined))
    .filter((part): part is string => typeof part === "string")
    .join("");
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .map((item) => (isRecord(item) ? stringAt(item, ["text"]) : undefined))
      .filter((item): item is string => typeof item === "string")
      .join("");
    if (text) return text;
  }
  return JSON.stringify(value ?? null);
}
