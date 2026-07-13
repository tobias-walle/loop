import type { AgentEvent } from "../agents/types.js";
import { nonNegativeIntegerField as numberField, stringField } from "../lib/record-fields.js";
import type { SessionEvent, StoredInvocation, UsageSnapshot } from "../lib/session-events.js";
import type { createEventRouter } from "./event-router.js";
import type { RunView } from "./run-view.js";
import { describeStep } from "./step-display.js";

export function replaySession(
  view: RunView,
  events: SessionEvent[],
  invocation: StoredInvocation,
): void {
  view.reset();
  const router = view.router;
  router.showSessionInfo(invocation.sessionId);
  const usage = new Map<string, UsageSnapshot>();
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event) replayEvent(router, event, invocation, usage, events[index + 1]);
  }
}

function replayEvent(
  router: ReturnType<typeof createEventRouter>,
  event: SessionEvent,
  invocation: StoredInvocation,
  usage: Map<string, UsageSnapshot>,
  nextEvent?: SessionEvent,
): void {
  const stepIndex = numberField(event.data, "stepIndex");
  if (event.type === "step_started" && stepIndex !== undefined) {
    if (nextEvent?.type !== "step_iteration_started") showStepHeader(router, invocation, stepIndex);
    return;
  }
  if (event.type === "step_iteration_started" && stepIndex !== undefined) {
    showStepHeader(
      router,
      invocation,
      stepIndex,
      numberField(event.data, "iteration"),
      numberField(event.data, "max"),
    );
    return;
  }
  if (event.type === "agent_event" && stepIndex !== undefined) {
    const agentEvent = event.data.event;
    if (isAgentEvent(agentEvent)) router.handleEvent(agentEvent, stepIndex);
    return;
  }
  if (event.type === "agent_usage_updated") {
    const snapshot = usageSnapshot(event.data);
    if (snapshot) usage.set(snapshot.executionId, snapshot);
    return;
  }
  if (event.type === "attempt_aborted") router.showInterruption();
  else if (
    event.type === "agent_session_cancelled" ||
    event.type === "attempt_failed" ||
    event.type === "attempt_completed"
  )
    router.finishActiveSession();
  if (event.type === "agent_session_completed") {
    router.finishActiveSession();
    const executionId = stringField(event.data, "executionId");
    const exitReason = stringField(event.data, "exitReason");
    const snapshot = executionId ? usage.get(executionId) : undefined;
    if (snapshot && isCompletionReason(exitReason)) {
      router.showCompletion(
        exitReason,
        snapshot.durationMs ?? 0,
        numberField(event.data, "iteration"),
        snapshot.costUsd,
        snapshot.usage,
      );
    }
  }
}

function showStepHeader(
  router: ReturnType<typeof createEventRouter>,
  invocation: StoredInvocation,
  stepIndex: number,
  storedIteration?: number,
  storedMax?: number,
): void {
  const step = invocation.steps[stepIndex];
  if (!step) return;
  const { task, isLoop, max } = describeStep(step);
  router.showStepHeader(
    stepIndex + 1,
    invocation.steps.length,
    task,
    isLoop ? (storedIteration ?? 1) : undefined,
    storedMax ?? max,
    invocation.agent.model,
    invocation.agent.name,
    { ...invocation.agent.args, ...(step.args ?? {}) },
  );
}

function usageSnapshot(value: Record<string, unknown>): UsageSnapshot | undefined {
  const executionId = stringField(value, "executionId");
  const costUsd = value.costUsd;
  const durationMs = value.durationMs;
  const usage = value.usage;
  if (
    !executionId ||
    typeof costUsd !== "number" ||
    !usage ||
    typeof usage !== "object" ||
    typeof (usage as { inputTokens?: unknown }).inputTokens !== "number" ||
    typeof (usage as { outputTokens?: unknown }).outputTokens !== "number"
  )
    return undefined;
  return {
    executionId,
    costUsd,
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    usage: usage as UsageSnapshot["usage"],
  };
}

function isCompletionReason(
  value: string | undefined,
): value is "done" | "loop_done" | "max_reached" {
  return value === "done" || value === "loop_done" || value === "max_reached";
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
  );
}
