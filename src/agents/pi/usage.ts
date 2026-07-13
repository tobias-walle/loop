import type { TokenUsage } from "../types.js";
import { isRecord, numberAt, recordAt } from "./object.js";

export function hasRunUsage(raw: Record<string, unknown>): boolean {
  return (
    !!recordAt(raw, ["usage"]) ||
    !!recordAt(raw, ["message", "usage"]) ||
    !!recordAt(raw, ["assistant", "usage"]) ||
    (Array.isArray(raw.messages) &&
      raw.messages.some((message) => isRecord(message) && !!recordAt(message, ["usage"])))
  );
}

export function hasRunCost(raw: Record<string, unknown>): boolean {
  if (typeof raw.costUsd === "number") return true;
  const usage =
    recordAt(raw, ["usage"]) ??
    recordAt(raw, ["message", "usage"]) ??
    recordAt(raw, ["assistant", "usage"]);
  if (typeof numberAt(usage, ["cost", "total"]) === "number") return true;
  return (
    Array.isArray(raw.messages) &&
    raw.messages.some(
      (message) =>
        isRecord(message) && typeof numberAt(message, ["usage", "cost", "total"]) === "number",
    )
  );
}

export function extractRunUsage(raw: Record<string, unknown>): TokenUsage {
  const usageRaw =
    recordAt(raw, ["usage"]) ??
    recordAt(raw, ["message", "usage"]) ??
    recordAt(raw, ["assistant", "usage"]);
  if (usageRaw) return usageFromRaw(usageRaw);

  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  return messages.reduce<TokenUsage>((total, message) => {
    if (!isRecord(message) || message.role !== "assistant") return total;
    const usage = recordAt(message, ["usage"]);
    if (!usage) return total;
    return addUsage(total, usageFromRaw(usage));
  }, zeroUsage());
}

export function extractRunCost(raw: Record<string, unknown>): number {
  const usageRaw =
    recordAt(raw, ["usage"]) ??
    recordAt(raw, ["message", "usage"]) ??
    recordAt(raw, ["assistant", "usage"]);
  if (usageRaw) return numberAt(usageRaw, ["cost", "total"]) ?? numberAt(raw, ["costUsd"]) ?? 0;

  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  return messages.reduce(
    (total, message) => {
      if (!isRecord(message) || message.role !== "assistant") return total;
      return total + (numberAt(message, ["usage", "cost", "total"]) ?? 0);
    },
    numberAt(raw, ["costUsd"]) ?? 0,
  );
}

export function usageFromRaw(usageRaw: Record<string, unknown>): TokenUsage {
  return {
    inputTokens: numberAt(usageRaw, ["input"]) ?? numberAt(usageRaw, ["inputTokens"]) ?? 0,
    outputTokens: numberAt(usageRaw, ["output"]) ?? numberAt(usageRaw, ["outputTokens"]) ?? 0,
    cacheCreationTokens:
      numberAt(usageRaw, ["cacheWrite"]) ?? numberAt(usageRaw, ["cacheCreationTokens"]) ?? 0,
    cacheReadTokens:
      numberAt(usageRaw, ["cacheRead"]) ?? numberAt(usageRaw, ["cacheReadTokens"]) ?? 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
  };
}

export function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}
