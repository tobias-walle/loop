import type { AgentEvent } from "../agents/types.js";
import { formatDuration, formatTokens } from "../lib/format.js";
import type { SessionEvent, UsageSnapshot } from "../lib/session-event.js";
import type { Step } from "../lib/types.js";
import { consoleStyle, formatAssistantBlock, formatToolPreview } from "./console-run-format.js";
import type { RunOutput, RunReporter } from "./run-reporter.js";

export type { RunOutput } from "./run-reporter.js";

type Iteration = { iteration: number; max?: number };

class ConsoleRunReporter implements RunReporter {
  private readonly activeSteps = new Map<number, Step>();
  private readonly iterationByStep = new Map<number, Iteration>();
  private readonly usageByExecution = new Map<string, UsageSnapshot>();
  private readonly reportedEvents = new Set<string>();
  private readonly reportedTools = new Set<string>();
  private readonly reportedTasks = new Set<string>();
  private interrupted = false;
  private disabled = false;
  private disposed = false;

  constructor(private readonly output: RunOutput) {}

  report(event: SessionEvent): void {
    if (this.disposed || this.disabled || this.reportedEvents.has(event.id)) return;
    this.reportedEvents.add(event.id);
    try {
      this.handle(event);
    } catch {
      this.disabled = true;
    }
  }

  [Symbol.dispose](): void {
    if (this.disposed) return;
    this.disposed = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this[Symbol.dispose]();
  }

  private handle(event: SessionEvent): void {
    const data = event.data;
    const stepIndex = numberField(data, "stepIndex");
    if (event.type === "step_started" && stepIndex !== undefined && isStep(data.step)) {
      this.activeSteps.set(stepIndex, data.step);
      return;
    }
    if (event.type === "step_iteration_started" && stepIndex !== undefined) {
      const iteration = numberField(data, "iteration") ?? 1;
      const max = numberField(data, "max");
      this.iterationByStep.set(stepIndex, { iteration, ...(max === undefined ? {} : { max }) });
      this.write(this.stepHeading(stepIndex));
      return;
    }
    if (event.type === "agent_event") {
      const agentEvent = data.event;
      if (isAgentEvent(agentEvent)) this.handleAgent(agentEvent);
      return;
    }
    if (event.type === "agent_usage_updated") {
      const usage = usageSnapshot(data);
      if (usage) this.usageByExecution.set(usage.executionId, usage);
      return;
    }
    if (event.type === "agent_session_completed") {
      const executionId = stringField(data, "executionId");
      const usage = executionId ? this.usageByExecution.get(executionId) : undefined;
      const reason = stringField(data, "exitReason") ?? "done";
      const details = usage
        ? ` · ${formatDuration(usage.durationMs ?? 0)} · $${usage.costUsd.toFixed(2)} · ${formatTokens(usage.usage)}`
        : "";
      this.write(this.style.success(`✓ ${reason}${details}`));
      return;
    }
    if (event.type === "step_failed") {
      this.write(this.style.error(`✕ step failed${errorSuffix(data)}`));
      return;
    }
    if (event.type === "step_cancelled") this.interrupt();
    else if (event.type === "attempt_aborted") this.interrupt();
    else if (event.type === "attempt_failed")
      this.write(this.style.error(`✕ run failed${errorSuffix(data)}`));
    else if (event.type === "run_completed") this.write(this.runSummary());
    else if (event.type === "diagnostic" && data.actionable === true)
      this.write(this.style.warning(`▲ ${stringField(data, "message") ?? "warning"}`));
  }

  private handleAgent(event: AgentEvent): void {
    switch (event.type) {
      case "text_done":
        this.write(formatAssistantBlock(event.text, this.output.isTTY));
        break;
      case "tool_start":
        if (this.reportedTools.has(event.toolId)) break;
        this.reportedTools.add(event.toolId);
        this.write(this.style.tool(`◆ ${formatToolPreview(event.tool, event.input)}`));
        break;
      case "task_started":
        if (!this.reportedTools.has(event.toolUseId)) {
          this.reportedTools.add(event.toolUseId);
          this.write(this.style.tool(`◈ agent ${event.description}`));
        }
        break;
      case "task_done":
        if (this.reportedTasks.has(event.taskId)) break;
        this.reportedTasks.add(event.taskId);
        this.write(
          this.style.secondary(
            `└ ${event.status}: ${event.summary} · ${formatDuration(event.durationMs)}`,
          ),
        );
        break;
      case "retry":
        this.write(
          this.style.warning(`↻ retry ${event.attempt}/${event.maxRetries}: ${event.error}`),
        );
        break;
      case "error":
        this.write(this.style.error(`✕ error ${event.message}`));
        break;
      case "usage_update":
      case "text_delta":
      case "session_start":
      case "tool_done":
      case "rate_limit":
      case "done":
      case "unknown":
        break;
    }
  }

  private stepHeading(stepIndex: number): string {
    const step = this.activeSteps.get(stepIndex);
    const iteration = this.iterationByStep.get(stepIndex);
    const task = step ? (step.type === "task" ? step.task : step.tasks.join(" · ")) : "Step";
    const suffix = iteration
      ? ` [iteration ${iteration.iteration}${iteration.max ? `/${iteration.max}` : ""}]`
      : "";
    return this.style.heading(`\nStep ${stepIndex + 1}: ${task}${suffix}`);
  }

  private interrupt(): void {
    if (this.interrupted) return;
    this.interrupted = true;
    this.write(this.style.warning("▲ interrupted"));
  }

  private runSummary(): string {
    let cost = 0;
    let duration = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const snapshot of this.usageByExecution.values()) {
      cost += snapshot.costUsd;
      duration += snapshot.durationMs ?? 0;
      inputTokens += snapshot.usage.inputTokens;
      outputTokens += snapshot.usage.outputTokens;
    }
    return this.style.success(
      `✓ loop · ${formatDuration(duration)} · $${cost.toFixed(2)} · ${formatTokens({ inputTokens, outputTokens })}`,
    );
  }

  private get style() {
    return consoleStyle(this.output.isTTY);
  }

  private write(text: string): void {
    this.output.write(`${text.replace(/\n+$/, "")}\n`);
  }
}

export function createConsoleRunReporter(output: RunOutput): RunReporter {
  return new ConsoleRunReporter(output);
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
  );
}

function isStep(value: unknown): value is Step {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  return step.type === "task" || step.type === "group";
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  return typeof data[key] === "number" ? data[key] : undefined;
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === "string" ? data[key] : undefined;
}

function errorSuffix(data: Record<string, unknown>): string {
  const error = stringField(data, "error");
  return error ? `: ${error}` : "";
}

function usageSnapshot(data: Record<string, unknown>): UsageSnapshot | undefined {
  const executionId = stringField(data, "executionId");
  const usage = data.usage as UsageSnapshot["usage"] | undefined;
  if (!executionId || typeof data.costUsd !== "number" || !usage) return undefined;
  return {
    executionId,
    costUsd: data.costUsd,
    ...(typeof data.durationMs === "number" ? { durationMs: data.durationMs } : {}),
    usage,
  };
}
