import type { AgentEvent, TokenUsage } from "../types.js";

export type PiEventState = {
  text: string;
  sessionStarted: boolean;
};

export function createPiEventState(): PiEventState {
  return { text: "", sessionStarted: false };
}

export function mapPiEvent(raw: unknown, state: PiEventState): AgentEvent[] {
  if (!isRecord(raw) || typeof raw.type !== "string") return [];
  const type = raw.type;
  switch (type) {
    case "agent_start": {
      const model = stringAt(raw, ["model"]) ?? stringAt(raw, ["agent", "model"]) ?? "pi";
      const sessionId =
        stringAt(raw, ["sessionId"]) ?? stringAt(raw, ["session", "id"]) ?? "pi-rpc";
      if (state.sessionStarted) return [];
      state.sessionStarted = true;
      return [{ type: "session_start", model, sessionId, tools: arrayOfStrings(raw.tools) }];
    }
    case "response":
      if (raw.success === false) {
        return [{ type: "error", message: stringAt(raw, ["error"]) ?? "pi RPC command failed" }];
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
      if (stopReason === "error")
        return [{ type: "error", message: "pi assistant message ended with error" }];
      return [];
    }
    case "extension_error":
      return [{ type: "error", message: stringAt(raw, ["message"]) ?? "pi extension error" }];
    case "agent_end":
      return [mapDone(raw, state)];
    default:
      return [{ type: "unknown", eventType: type, raw }];
  }
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

function mapDone(raw: Record<string, unknown>, state: PiEventState): AgentEvent {
  const finalMessage = extractFinalAssistantMessage(raw);
  const result = extractFinalText(raw, finalMessage) ?? state.text;
  const usageRaw =
    recordAt(raw, ["usage"]) ??
    recordAt(raw, ["message", "usage"]) ??
    recordAt(raw, ["assistant", "usage"]) ??
    recordAt(finalMessage, ["usage"]);
  const usage: TokenUsage = {
    inputTokens: numberAt(usageRaw, ["input"]) ?? numberAt(usageRaw, ["inputTokens"]) ?? 0,
    outputTokens: numberAt(usageRaw, ["output"]) ?? numberAt(usageRaw, ["outputTokens"]) ?? 0,
    cacheCreationTokens:
      numberAt(usageRaw, ["cacheWrite"]) ?? numberAt(usageRaw, ["cacheCreationTokens"]) ?? 0,
    cacheReadTokens:
      numberAt(usageRaw, ["cacheRead"]) ?? numberAt(usageRaw, ["cacheReadTokens"]) ?? 0,
  };
  const costUsd = numberAt(usageRaw, ["cost", "total"]) ?? numberAt(raw, ["costUsd"]) ?? 0;
  const durationMs = numberAt(raw, ["durationMs"]) ?? numberAt(raw, ["duration_ms"]) ?? 0;
  return { type: "done", result, costUsd, durationMs, usage };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, path: string[]): Record<string, unknown> | undefined {
  const found = getAt(value, path);
  return isRecord(found) ? found : undefined;
}

function stringAt(value: unknown, path: string[]): string | undefined {
  const found = getAt(value, path);
  return typeof found === "string" ? found : undefined;
}

function numberAt(value: unknown, path: string[]): number | undefined {
  const found = getAt(value, path);
  return typeof found === "number" ? found : undefined;
}

function getAt(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
