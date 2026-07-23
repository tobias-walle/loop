import * as crypto from "node:crypto";
import * as fs from "node:fs";
import type { AgentArgs } from "./agent-args.js";
import { yellow } from "./ansi.js";
import { getSessionEventsPath } from "./storage-paths.js";
import type { RunSummary, Step, StepResult, TokenUsage } from "./types.js";

const SESSION_EVENT_TYPES = [
  "session_created",
  "attempt_started",
  "attempt_completed",
  "attempt_aborted",
  "attempt_failed",
  "step_started",
  "step_iteration_started",
  "step_completed",
  "step_cancelled",
  "step_failed",
  "agent_session_started",
  "agent_usage_updated",
  "agent_event",
  "agent_session_completed",
  "agent_session_cancelled",
  "run_completed",
  "diagnostic",
  "lock_invalidated",
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

const SESSION_EVENT_TYPE_SET = new Set<string>(SESSION_EVENT_TYPES);

export type StoredInvocation = {
  sessionId: string;
  loopVersion: string;
  projectRoot: string;
  steps: Step[];
  template: { source: "user" | "default"; content: string; sha256: string };
  agent: {
    name: "claude" | "pi";
    command?: string;
    model?: string;
    args: AgentArgs;
    passthroughArgs: string[];
  };
  recipe?: { name: string; path: string; sha256?: string };
};

export type SessionEvent<T = Record<string, unknown>> = {
  version: 1;
  id: string;
  timestamp: string;
  type: SessionEventType;
  attemptId?: string;
  ownerId?: string;
  data: T;
};

export type CompletedStep = {
  stepIndex: number;
  summary: string;
  result: StepResult;
  executionIds?: string[];
};

export type UsageSnapshot = {
  executionId: string;
  costUsd: number;
  usage: TokenUsage;
  durationMs?: number;
};
export function createEvent<T>(
  type: SessionEventType,
  data: T,
  ownership: Pick<SessionEvent, "attemptId" | "ownerId"> = {},
): SessionEvent<T> {
  return {
    version: 1,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    ...ownership,
    data,
  };
}

const SESSION_EVENT_WRITE_RETRIES = 3;
const failedEventPaths = new Set<string>();

export function appendSessionEvent(
  sessionDir: string,
  event: SessionEvent,
  onError: (error: Error) => void = reportSessionEventWriteFailure,
): boolean {
  const file = getSessionEventsPath(sessionDir);
  let cause: unknown;
  for (let attempt = 0; attempt <= SESSION_EVENT_WRITE_RETRIES; attempt++) {
    try {
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
      failedEventPaths.delete(file);
      return true;
    } catch (error) {
      cause = error;
    }
  }

  if (!failedEventPaths.has(file)) {
    failedEventPaths.add(file);
    const detail = cause instanceof Error ? cause.message : String(cause);
    try {
      onError(
        new Error(
          `Could not append session events to ${file} after ${SESSION_EVENT_WRITE_RETRIES} retries: ${detail}. The run will continue without recording this event.`,
        ),
      );
    } catch {
      // Reporting a persistence failure must not stop the active run either.
    }
  }
  return false;
}

function reportSessionEventWriteFailure(error: Error): void {
  process.stderr.write(`${yellow("Warning:")} ${error.message}\n`);
}

export type ReadEventsResult = {
  events: SessionEvent[];
  warnings: string[];
  unsupportedVersion: boolean;
};

export function readSessionEvents(sessionDir: string): ReadEventsResult {
  const file = getSessionEventsPath(sessionDir);
  if (!fs.existsSync(file)) return { events: [], warnings: [], unsupportedVersion: false };
  const contents = fs.readFileSync(file, "utf-8");
  const lines = contents.split("\n");
  const events: SessionEvent[] = [];
  const warnings: string[] = [];
  let unsupportedVersion = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!isSessionEvent(value)) {
        if (index === lines.length - 1 && !contents.endsWith("\n")) {
          warnings.push("Ignored malformed final event line.");
          continue;
        }
        warnings.push(`Ignored malformed event at line ${index + 1}.`);
        continue;
      }
      if (value.version !== 1) {
        unsupportedVersion = true;
        warnings.push(`Unsupported event version at line ${index + 1}.`);
        continue;
      }
      events.push(value);
    } catch {
      if (index === lines.length - 1 && !contents.endsWith("\n"))
        warnings.push("Ignored malformed final event line.");
      else warnings.push(`Ignored malformed event at line ${index + 1}.`);
    }
  }
  return { events, warnings, unsupportedVersion };
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.version === "number" &&
    typeof event.id === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.type === "string" &&
    SESSION_EVENT_TYPE_SET.has(event.type) &&
    !!event.data &&
    typeof event.data === "object" &&
    !Array.isArray(event.data)
  );
}

export function isStep(value: unknown): value is Step {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  return (
    (step.type === "task" && typeof step.task === "string") ||
    (step.type === "group" &&
      Array.isArray(step.tasks) &&
      step.tasks.every((task) => typeof task === "string"))
  );
}

export function isTokenUsage(value: unknown): value is TokenUsage {
  return (
    !!value &&
    typeof value === "object" &&
    ["inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens"].every(
      (key) => typeof (value as Record<string, unknown>)[key] === "number",
    )
  );
}

export function isStepResult(value: unknown): value is StepResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    isStep(result.step) &&
    typeof result.iterations === "number" &&
    Number.isInteger(result.iterations) &&
    result.iterations > 0 &&
    typeof result.result === "string" &&
    typeof result.costUsd === "number" &&
    typeof result.durationMs === "number" &&
    isTokenUsage(result.usage) &&
    ["done", "loop_done", "max_reached", "error"].includes(String(result.exitReason)) &&
    (result.error === undefined || typeof result.error === "string")
  );
}

export function emptyRunSummary(): RunSummary {
  return {
    totalCostUsd: 0,
    totalDurationMs: 0,
    totalUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  };
}
