import type { AgentEvent } from "../agents/types.js";
import { nonNegativeIntegerField } from "./record-fields.js";
import {
  type CompletedStep,
  emptyRunSummary,
  isStep,
  isStepResult,
  isTokenUsage,
  type SessionEvent,
  type StoredInvocation,
  type UsageSnapshot,
} from "./session-event.js";
import type { RunSummary, TokenUsage } from "./types.js";

export type SessionStatus = "running" | "completed" | "failed" | "aborted" | "legacy" | "corrupt";
export type AttemptSummary = {
  id: string;
  startedAt: string;
  status: "running" | "completed" | "failed" | "aborted";
  endedAt?: string;
};
export type HistoryEntry = {
  timestamp: string;
  stepIndex?: number;
  event: AgentEvent | SessionEvent;
};

export type SessionAggregate = {
  invocation?: StoredInvocation;
  status: SessionStatus;
  attempts: AttemptSummary[];
  completedSteps: Map<number, CompletedStep>;
  activeStepIndex?: number;
  nextStepIndex: number;
  previousStepSummary?: string;
  totals: RunSummary;
  transcript: HistoryEntry[];
  warnings: string[];
  resumable: boolean;
  interrupted: boolean;
  lastEventId?: string;
};

export function reduceSessionEvents(events: SessionEvent[]): SessionAggregate {
  const aggregate: SessionAggregate = {
    status: "running",
    attempts: [],
    completedSteps: new Map(),
    nextStepIndex: 0,
    totals: emptyRunSummary(),
    transcript: [],
    warnings: [],
    resumable: false,
    interrupted: false,
  };
  const ids = new Set<string>();
  const invalidatedOwners = new Set<string>();
  const usageByExecution = new Map<string, UsageSnapshot>();
  const completed = new Map<number, CompletedStep>();
  let invalidCreation = false;

  for (const event of events) {
    aggregate.lastEventId = event.id;
    if (ids.has(event.id)) {
      aggregate.warnings.push(`Duplicate event ID ${event.id}.`);
      continue;
    }
    ids.add(event.id);
    if (event.type === "lock_invalidated" && typeof event.data.ownerId === "string")
      invalidatedOwners.add(event.data.ownerId);
    const orphaned = event.ownerId !== undefined && invalidatedOwners.has(event.ownerId);
    if (event.type === "diagnostic" || orphaned) {
      aggregate.transcript.push({ timestamp: event.timestamp, event });
    } else if (event.type === "agent_event") {
      const data = event.data as { stepIndex?: number; executionId?: string; event?: AgentEvent };
      if (data.event) {
        aggregate.transcript.push({
          timestamp: event.timestamp,
          stepIndex: data.stepIndex,
          event: data.event,
        });
        if (
          data.event.type === "usage_update" &&
          typeof data.executionId === "string" &&
          typeof data.event.costUsd === "number" &&
          isTokenUsage(data.event.usage)
        ) {
          usageByExecution.set(data.executionId, {
            executionId: data.executionId,
            costUsd: data.event.costUsd,
            usage: data.event.usage,
          });
        }
      }
    }
    if (orphaned) continue;

    if (event.type === "session_created") {
      if (aggregate.invocation) aggregate.warnings.push("Multiple session_created events.");
      else if (isStoredInvocation(event.data)) aggregate.invocation = event.data;
      else {
        invalidCreation = true;
        aggregate.warnings.push("Invalid session_created event.");
      }
    } else if (event.type === "attempt_started") {
      const id = event.attemptId ?? event.id;
      aggregate.attempts.push({ id, startedAt: event.timestamp, status: "running" });
      aggregate.status = "running";
    } else if (
      event.type === "attempt_completed" ||
      event.type === "attempt_failed" ||
      event.type === "attempt_aborted"
    ) {
      const attempt =
        [...aggregate.attempts].reverse().find((item) => item.id === event.attemptId) ??
        aggregate.attempts.at(-1);
      if (attempt) {
        attempt.status =
          event.type === "attempt_completed"
            ? "completed"
            : event.type === "attempt_failed"
              ? "failed"
              : "aborted";
        attempt.endedAt = event.timestamp;
      }
      aggregate.status =
        event.type === "attempt_completed"
          ? "completed"
          : event.type === "attempt_failed"
            ? "failed"
            : "aborted";
    } else if (event.type === "step_started") {
      const index = nonNegativeIntegerField(event.data, "stepIndex");
      if (index !== undefined) aggregate.activeStepIndex = index;
    } else if (event.type === "step_completed") {
      const index = nonNegativeIntegerField(event.data, "stepIndex");
      const result = isStepResult(event.data.result) ? event.data.result : undefined;
      const summary =
        typeof event.data.summary === "string" ? event.data.summary : result?.result?.slice(-500);
      if (index === undefined || !result || summary === undefined)
        aggregate.warnings.push("Invalid step_completed event.");
      else if (completed.has(index))
        aggregate.warnings.push(`Duplicate completed step ${index + 1}.`);
      else
        completed.set(index, {
          stepIndex: index,
          result,
          summary,
          executionIds: stringArrayField(event.data, "executionIds"),
        });
      aggregate.activeStepIndex = undefined;
    } else if (event.type === "step_cancelled" || event.type === "step_failed") {
      aggregate.activeStepIndex = nonNegativeIntegerField(event.data, "stepIndex");
    } else if (event.type === "agent_usage_updated") {
      const snapshot = event.data as unknown as UsageSnapshot;
      if (
        typeof snapshot.executionId === "string" &&
        isTokenUsage(snapshot.usage) &&
        typeof snapshot.costUsd === "number"
      )
        usageByExecution.set(snapshot.executionId, snapshot);
    } else if (event.type === "run_completed") aggregate.status = "completed";
  }

  aggregate.completedSteps = completed;
  if (!aggregate.invocation) {
    aggregate.status = invalidCreation ? "corrupt" : "legacy";
    if (!invalidCreation) aggregate.warnings.push("This session predates resume events.");
    return aggregate;
  }
  for (let index = 0; index < aggregate.invocation.steps.length; index++) {
    if (!completed.has(index)) {
      aggregate.nextStepIndex = index;
      break;
    }
    aggregate.nextStepIndex = index + 1;
  }
  for (const index of completed.keys()) {
    if (index >= aggregate.nextStepIndex)
      aggregate.warnings.push("Completed steps are not a contiguous prefix.");
  }
  if (
    aggregate.warnings.some(
      (warning) =>
        warning.includes("contiguous") ||
        warning.includes("Invalid") ||
        warning.includes("Duplicate completed"),
    )
  ) {
    aggregate.status = "corrupt";
    return aggregate;
  }
  const previous = completed.get(aggregate.nextStepIndex - 1);
  aggregate.previousStepSummary = previous?.summary;
  aggregate.interrupted = aggregate.activeStepIndex === aggregate.nextStepIndex;
  if (aggregate.nextStepIndex === aggregate.invocation.steps.length) aggregate.status = "completed";
  aggregate.resumable = aggregate.status !== "completed";
  aggregate.totals = sumTotals(completed, usageByExecution);
  return aggregate;
}

function isStoredInvocation(value: unknown): value is StoredInvocation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const template = item.template as Record<string, unknown> | undefined;
  const agent = item.agent as Record<string, unknown> | undefined;
  return (
    typeof item.sessionId === "string" &&
    typeof item.loopVersion === "string" &&
    typeof item.projectRoot === "string" &&
    Array.isArray(item.steps) &&
    item.steps.every(isStep) &&
    !!template &&
    (template.source === "user" || template.source === "default") &&
    typeof template.content === "string" &&
    typeof template.sha256 === "string" &&
    !!agent &&
    (agent.name === "claude" || agent.name === "pi") &&
    !!agent.args &&
    typeof agent.args === "object" &&
    Array.isArray(agent.passthroughArgs) &&
    agent.passthroughArgs.every((arg) => typeof arg === "string")
  );
}

function stringArrayField(value: Record<string, unknown>, field: string): string[] | undefined {
  const candidate = value[field];
  return Array.isArray(candidate) && candidate.every((item) => typeof item === "string")
    ? candidate
    : undefined;
}
function sumTotals(
  steps: Map<number, CompletedStep>,
  snapshots: Map<string, UsageSnapshot>,
): RunSummary {
  const totals = emptyRunSummary();
  for (const step of steps.values()) {
    const representedBySnapshots =
      step.executionIds &&
      step.executionIds.length > 0 &&
      step.executionIds.every((executionId) => snapshots.has(executionId));
    if (!representedBySnapshots) {
      totals.totalCostUsd += step.result.costUsd;
      totals.totalDurationMs += step.result.durationMs;
      addUsage(totals.totalUsage, step.result.usage);
    }
  }
  for (const snapshot of snapshots.values()) {
    totals.totalCostUsd += snapshot.costUsd;
    totals.totalDurationMs += snapshot.durationMs ?? 0;
    addUsage(totals.totalUsage, snapshot.usage);
  }
  return totals;
}
function addUsage(target: TokenUsage, source: TokenUsage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheCreationTokens += source.cacheCreationTokens;
  target.cacheReadTokens += source.cacheReadTokens;
}
