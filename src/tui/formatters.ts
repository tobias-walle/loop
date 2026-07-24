import { truncateToWidth } from "@mariozechner/pi-tui";
import type { AgentArgs } from "../lib/agent-args.js";
import {
  bold,
  boldCyan,
  boldGreen,
  boldRed,
  cyan,
  dim,
  green,
  magenta,
  yellow,
} from "../lib/ansi.js";
import { formatDuration, formatTokens } from "../lib/format.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";

const TOOL_LABEL_WIDTH = 6;
const STATUS_LABEL_WIDTH = 6;

export function formatToolLine(
  tool: string,
  input: Record<string, unknown>,
  maxWidth = 100,
): string {
  switch (tool) {
    case "Read": {
      const p = (input.file_path ?? input.path ?? "") as string;
      return formatToolEvent("◇", "read", p, maxWidth, yellow);
    }
    case "Write": {
      const p = (input.file_path ?? input.path ?? "") as string;
      return formatToolEvent("✎", "write", p, maxWidth, green);
    }
    case "Edit": {
      const p = (input.file_path ?? input.path ?? "") as string;
      return formatToolEvent("✎", "edit", p, maxWidth, cyan);
    }
    case "Bash": {
      const cmd = (input.command ?? "") as string;
      return formatToolEvent("◆", "bash", cmd, maxWidth, magenta);
    }
    case "Search":
    case "Grep": {
      const query = (input.query ?? input.pattern ?? "") as string;
      const p = (input.path ?? input.directory ?? "") as string;
      const pathSuffix = p ? ` in ${p}` : "";
      return formatToolEvent("⌕", tool.toLowerCase(), `"${query}"${pathSuffix}`, maxWidth, yellow);
    }
    case "Task":
    case "Agent": {
      const task = (input.task ?? input.description ?? "") as string;
      return formatToolEvent("◈", "agent", task, maxWidth, magenta);
    }
    default: {
      const firstString = Object.values(input).find((v) => typeof v === "string") as
        | string
        | undefined;
      const suffix = firstString ? firstString : "";
      return formatToolEvent("◇", tool.toLowerCase(), suffix, maxWidth, yellow);
    }
  }
}

function formatToolEvent(
  symbol: string,
  label: string,
  payload: string,
  maxWidth: number,
  colorize: (text: string) => string,
): string {
  const labelText = label.padEnd(TOOL_LABEL_WIDTH);
  const prefixWidth = 2 + labelText.length + 1;
  const payloadWidth = Math.max(0, maxWidth - prefixWidth);
  const normalizedPayload = payload.replace(/\s+/g, " ").trim();
  const line = `${colorize(symbol)} ${colorize(labelText)} ${dim(
    truncateToWidth(normalizedPayload, payloadWidth),
  )}`;
  return truncateToWidth(line, maxWidth, "");
}

function formatStatusLine(
  symbol: string,
  label: string,
  details: string,
  colorize: (text: string) => string,
): string {
  const labelText = label.padEnd(STATUS_LABEL_WIDTH);
  return details
    ? `${colorize(symbol)} ${colorize(labelText)} ${details}`
    : `${colorize(symbol)} ${colorize(labelText)}`;
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatStepHeaderLines(
  step: number,
  totalSteps: number,
  task: string,
  iteration?: number,
  max?: number,
  model?: string,
  agent?: string,
  agentArgs?: AgentArgs,
): [string, string] {
  const stepWidth = Math.max(2, String(totalSteps).length);
  const parts = [`step ${padNumber(step, stepWidth)}/${padNumber(totalSteps, stepWidth)}`];

  if (iteration != null) {
    const iterWidth = Math.max(2, String(max ?? iteration).length);
    const iter =
      max != null
        ? `iter ${padNumber(iteration, iterWidth)}/${padNumber(max, iterWidth)}`
        : `iter ${padNumber(iteration, iterWidth)}`;
    parts.push(iter);
  }

  if (agent) parts.push(formatAgentHeader(agent, agentArgs));
  if (model) parts.push(model);

  return [boldCyan(`[${parts.join(" · ")}]`), bold(task)];
}

function formatAgentHeader(agent: string, args?: AgentArgs): string {
  const flagParts = Object.entries(args ?? {})
    .filter(([, value]) => value !== false)
    .map(([name, value]) => (value === true ? name : `${name}=${value}`));

  if (flagParts.length === 0) return agent;
  return `${agent} · ${flagParts.join(" ")}`;
}

export function formatStepHeader(
  step: number,
  totalSteps: number,
  task: string,
  iteration?: number,
  max?: number,
  model?: string,
  agent?: string,
  agentArgs?: AgentArgs,
): string {
  return formatStepHeaderLines(
    step,
    totalSteps,
    task,
    iteration,
    max,
    model,
    agent,
    agentArgs,
  ).join("\n");
}

export { formatDuration, formatTokenCount, formatTokens } from "../lib/format.js";

export function formatInterruption(): string {
  return formatStatusLine("▲", "interrupted", "", yellow);
}

export function formatCompletion(
  type: "done" | "loop_done" | "max_reached",
  durationMs: number,
  iterations?: number,
  costUsd?: number,
  usage?: TokenUsage,
): string {
  const sep = dim(" · ");
  const stats: string[] = [];

  if (iterations != null && iterations > 1) {
    stats.push(yellow(`${iterations} iterations`));
  } else if (iterations != null && type === "loop_done") {
    stats.push(yellow(`${iterations} iteration`));
  }
  stats.push(dim(formatDuration(durationMs)));
  if (costUsd != null) stats.push(green(`$${costUsd.toFixed(2)}`));
  if (usage != null) stats.push(cyan(formatTokens(usage)));

  const details = stats.join(sep);

  switch (type) {
    case "done":
      return formatStatusLine("✓", "done", details, green);
    case "loop_done":
      return formatStatusLine("✓", "done", details, boldGreen);
    case "max_reached":
      return formatStatusLine("▲", "max", details, yellow);
  }
}

export function formatRunSummary(summary: RunSummary): string {
  const sep = dim(" · ");
  const parts = [
    dim(formatDuration(summary.totalDurationMs)),
    green(`$${summary.totalCostUsd.toFixed(2)}`),
    cyan(formatTokens(summary.totalUsage)),
  ];
  return formatStatusLine("✓", "loop", parts.join(sep), magenta);
}

export function formatRetry(attempt: number, maxRetries: number, error: string): string {
  return formatStatusLine("↻", "retry", dim(`${attempt}/${maxRetries} · ${error}`), dim);
}

export function formatError(message: string): string {
  return formatStatusLine("✕", "error", message, boldRed);
}
