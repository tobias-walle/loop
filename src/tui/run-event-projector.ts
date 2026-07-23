import type { AgentEvent, TokenUsage as AgentTokenUsage } from "../agents/types.js";
import { emptyRunSummary, type SessionEvent, type StoredInvocation } from "../lib/session-event.js";
import type { RunSummary, Step, TokenUsage } from "../lib/types.js";
import type { StatusBar } from "./components/status-bar.js";
import { createRunView } from "./run-view.js";
import { describeStep } from "./step-display.js";

type ProjectionStatus = Pick<StatusBar, "hide" | "setStatus" | "show">;

export class RunEventProjector {
  readonly view;
  private readonly events = new Set<string>();
  private readonly steps = new Map<number, Step>();
  private readonly usageByExecution = new Map<string, RunSummary>();
  private invocation?: StoredInvocation;
  private currentUsage?: RunSummary;
  private currentUsageCommitted = false;
  private interrupted = false;

  constructor(
    private readonly requestRender: () => void,
    private readonly status?: ProjectionStatus,
  ) {
    this.view = createRunView(requestRender);
  }

  report(event: SessionEvent): void {
    if (this.events.has(event.id)) return;
    this.events.add(event.id);
    this.handle(event);
  }

  replay(events: readonly SessionEvent[]): void {
    for (const event of events) this.report(event);
  }

  finishActiveSession(): void {
    this.view.router.finishActiveSession();
  }

  render(width: number): string[] {
    return this.view.render(width);
  }

  private handle(event: SessionEvent): void {
    const data = event.data;
    const stepIndex = numberField(data, "stepIndex");
    switch (event.type) {
      case "session_created":
        if (isStoredInvocation(data)) {
          this.invocation = data;
          this.view.router.showSessionInfo(data.sessionId);
        }
        break;
      case "attempt_started":
        this.interrupted = false;
        this.status?.show();
        this.updateStatus();
        break;
      case "step_started":
        if (stepIndex !== undefined && isStep(data.step)) this.steps.set(stepIndex, data.step);
        break;
      case "step_iteration_started":
        if (stepIndex !== undefined) this.showStep(stepIndex, data);
        break;
      case "agent_event":
        if (stepIndex !== undefined && isAgentEvent(data.event)) {
          this.handleAgentEvent(data.event, stepIndex);
        }
        break;
      case "agent_usage_updated":
        this.rememberUsage(data);
        break;
      case "agent_session_completed":
        this.showCompletion(data);
        break;
      case "step_cancelled":
      case "attempt_aborted":
        this.showInterruption();
        this.hideStatus();
        break;
      case "attempt_failed":
        this.hideStatus();
        break;
      case "run_completed":
        this.view.router.showRunSummary(this.totalUsage());
        this.hideStatus();
        break;
      default:
        break;
    }
  }

  private handleAgentEvent(event: AgentEvent, stepIndex: number): void {
    this.view.router.handleEvent(event, stepIndex);
    if (event.type === "usage_update") {
      this.currentUsage = {
        totalCostUsd: event.costUsd,
        totalDurationMs: 0,
        totalUsage: fullUsage(event.usage),
      };
      this.currentUsageCommitted = false;
      this.updateStatus();
    }
  }

  private showStep(stepIndex: number, data: Record<string, unknown>): void {
    const step = this.steps.get(stepIndex) ?? this.invocation?.steps[stepIndex];
    if (!step) return;
    const display = describeStep(step);
    const iteration = numberField(data, "iteration") ?? 1;
    const configured = this.invocation?.agent;
    this.view.router.showStepHeader(
      stepIndex + 1,
      this.invocation?.steps.length ?? Math.max(this.steps.size, stepIndex + 1),
      display.task,
      display.isLoop ? iteration : undefined,
      numberField(data, "max") ?? display.max,
      configured?.model,
      configured?.name,
      { ...configured?.args, ...step.args },
    );
    this.currentUsage = undefined;
    this.currentUsageCommitted = false;
    this.updateStatus(stepIndex, display.isLoop ? iteration : undefined, display.max);
  }

  private rememberUsage(data: Record<string, unknown>): void {
    const executionId = stringField(data, "executionId");
    if (!(executionId && isTokenUsage(data.usage) && typeof data.costUsd === "number")) return;
    const summary = {
      totalCostUsd: data.costUsd,
      totalDurationMs: numberField(data, "durationMs") ?? 0,
      totalUsage: data.usage,
    };
    this.usageByExecution.set(executionId, summary);
    this.currentUsage = summary;
    this.currentUsageCommitted = true;
    this.updateStatus();
  }

  private showCompletion(data: Record<string, unknown>): void {
    const executionId = stringField(data, "executionId");
    const usage = executionId ? this.usageByExecution.get(executionId) : undefined;
    const reason = stringField(data, "exitReason");
    if (!(usage && isCompletionReason(reason))) return;
    this.view.router.showCompletion(
      reason,
      usage.totalDurationMs,
      numberField(data, "iteration"),
      usage.totalCostUsd,
      usage.totalUsage,
    );
    this.updateStatus();
  }

  private showInterruption(): void {
    if (this.interrupted) return;
    this.interrupted = true;
    this.view.router.showInterruption();
  }

  private updateStatus(stepIndex?: number, iteration?: number, max?: number): void {
    const total = this.totalUsage();
    const pending = this.currentUsageCommitted ? undefined : this.currentUsage;
    this.status?.setStatus({
      ...(stepIndex === undefined ? {} : { step: stepIndex + 1 }),
      totalSteps: this.invocation?.steps.length,
      iteration,
      max,
      costUsd: total.totalCostUsd + (pending?.totalCostUsd ?? 0),
      currentSessionCostUsd: this.currentUsage?.totalCostUsd,
      usage: addUsage(total.totalUsage, pending?.totalUsage),
      currentSessionUsage: this.currentUsage?.totalUsage,
    });
    this.requestRender();
  }

  private totalUsage(): RunSummary {
    const total = emptyRunSummary();
    for (const usage of this.usageByExecution.values()) {
      total.totalCostUsd += usage.totalCostUsd;
      total.totalDurationMs += usage.totalDurationMs;
      total.totalUsage = addUsage(total.totalUsage, usage.totalUsage);
    }
    return total;
  }

  private hideStatus(): void {
    this.status?.hide();
    this.requestRender();
  }
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
  );
}

function isStep(value: unknown): value is Step {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "task" || type === "group";
}

function isStoredInvocation(data: Record<string, unknown>): data is StoredInvocation {
  return typeof data.sessionId === "string" && Array.isArray(data.steps) && !!data.agent;
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Record<string, unknown>;
  return typeof usage.inputTokens === "number" && typeof usage.outputTokens === "number";
}

function fullUsage(usage: AgentTokenUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
  };
}

function addUsage(left: TokenUsage, right?: TokenUsage): TokenUsage {
  if (!right) return { ...left };
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  };
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  return typeof data[key] === "number" ? data[key] : undefined;
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === "string" ? data[key] : undefined;
}

function isCompletionReason(
  value: string | undefined,
): value is "done" | "loop_done" | "max_reached" {
  return value === "done" || value === "loop_done" || value === "max_reached";
}
