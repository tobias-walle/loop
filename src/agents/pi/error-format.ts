import { getAt, isRecord, recordAt, stringAt } from "./object.js";

export function formatMessageEndError(raw: Record<string, unknown>): string {
  const details = [
    firstStringAt(raw, [
      ["assistant", "errorMessage"],
      ["message", "errorMessage"],
      ["errorMessage"],
      ["assistant", "error", "message"],
      ["message", "error", "message"],
      ["error", "message"],
      ["error"],
    ]),
    formatMessageIdentity(raw),
    formatDiagnostics(raw),
  ].filter((part): part is string => Boolean(part));

  const fallback = details.length === 0 ? formatRawFallback(raw) : undefined;
  if (fallback) details.push(fallback);
  if (details.length === 0) return "pi assistant message ended with error";
  return `pi assistant message ended with error: ${details.join(" · ")}`;
}

function firstStringAt(raw: Record<string, unknown>, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = stringAt(raw, path);
    if (value) return value;
  }
  return undefined;
}

function formatMessageIdentity(raw: Record<string, unknown>): string | undefined {
  const message = recordAt(raw, ["assistant"]) ?? recordAt(raw, ["message"]);
  if (!message) return undefined;
  const parts = [
    stringAt(message, ["provider"]),
    stringAt(message, ["model"]),
    stringAt(message, ["responseId"]),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("/") : undefined;
}

function formatDiagnostics(raw: Record<string, unknown>): string | undefined {
  const diagnostics =
    getAt(raw, ["assistant", "diagnostics"]) ?? getAt(raw, ["message", "diagnostics"]);
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return undefined;
  const formatted = diagnostics
    .map(formatDiagnostic)
    .filter((part): part is string => Boolean(part))
    .slice(0, 3);
  return formatted.length > 0 ? `diagnostics: ${formatted.join(", ")}` : undefined;
}

function formatDiagnostic(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  return (
    stringAt(value, ["message"]) ??
    stringAt(value, ["error"]) ??
    stringAt(value, ["detail"]) ??
    stringAt(value, ["reason"])
  );
}

function formatRawFallback(raw: Record<string, unknown>): string | undefined {
  const compact = compactRawErrorEvent(raw);
  if (!compact) return undefined;
  return `raw: ${truncate(compact, 500)}`;
}

function compactRawErrorEvent(raw: Record<string, unknown>): string | undefined {
  const message = recordAt(raw, ["message"]);
  const assistant = recordAt(raw, ["assistant"]);
  const compact = removeLargeContent({
    ...raw,
    ...(message ? { message: removeLargeContent(message) } : {}),
    ...(assistant ? { assistant: removeLargeContent(assistant) } : {}),
  });
  try {
    return JSON.stringify(compact);
  } catch {
    return undefined;
  }
}

function removeLargeContent(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  if ("content" in copy) copy.content = "[omitted]";
  if ("messages" in copy) copy.messages = "[omitted]";
  return copy;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
