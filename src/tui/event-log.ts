import type { RunSummary, TokenUsage } from "../lib/types.js";
import {
  bold,
  boldCyan,
  boldGreen,
  boldMagenta,
  boldRed,
  boldYellow,
  cyan,
  dim,
  green,
  magenta,
  yellow,
} from "./colors.js";

export function formatToolLine(
  tool: string,
  input: Record<string, unknown>,
  maxWidth = 100,
): string {
  switch (tool) {
    case "Read": {
      const p = (input.file_path ?? input.path ?? "") as string;
      return `${yellow("⚙")} ${boldYellow("Read")} ${dim(truncate(p, maxWidth - 12))}`;
    }
    case "Write": {
      const p = (input.file_path ?? input.path ?? "") as string;
      return `${green("⚙")} ${boldGreen("Write")} ${dim(truncate(p, maxWidth - 13))}`;
    }
    case "Edit": {
      const p = (input.file_path ?? input.path ?? "") as string;
      return `${cyan("⚙")} ${boldCyan("Edit")} ${dim(truncate(p, maxWidth - 12))}`;
    }
    case "Bash": {
      const cmd = (input.command ?? "") as string;
      return `${magenta("⚙")} ${boldMagenta("Bash")} ${dim(truncate(cmd, maxWidth - 12))}`;
    }
    case "Search":
    case "Grep": {
      const query = (input.query ?? input.pattern ?? "") as string;
      const p = (input.path ?? input.directory ?? "") as string;
      const pathSuffix = p ? ` in ${p}` : "";
      return `${yellow("⚙")} ${boldYellow(tool)} ${dim(truncate(`"${query}"${pathSuffix}`, maxWidth - tool.length - 5))}`;
    }
    case "Task":
    case "Agent": {
      const task = (input.task ?? input.description ?? "") as string;
      return `${boldMagenta("⚙ Agent:")} ${dim(truncate(task, maxWidth - 12))}`;
    }
    default: {
      const firstString = Object.values(input).find((v) => typeof v === "string") as
        | string
        | undefined;
      const suffix = firstString ? `: ${firstString}` : "";
      return `${yellow("⚙")} ${boldYellow(tool)}${dim(truncate(suffix, maxWidth - tool.length - 5))}`;
    }
  }
}

function truncate(text: string, max: number): string {
  if (max <= 3) return text.slice(0, max);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function formatStepHeader(
  step: number,
  totalSteps: number,
  task: string,
  iteration?: number,
  max?: number,
): string {
  let iterPart = "";
  if (iteration != null) {
    iterPart = max != null ? ` - iteration ${iteration}/${max}` : ` - iteration ${iteration}`;
  }
  const stepLabel = boldCyan(`Step ${step}/${totalSteps}`);
  const taskLabel = bold(task);
  const iterLabel = iterPart ? dim(iterPart) : "";
  const dash = dim("───");
  return `${dash} ${stepLabel} ${taskLabel}${iterLabel} ${dash}`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) {
    return `${min}m ${sec.toString().padStart(2, "0")}s`;
  }
  return `${sec}s`;
}

export function formatTokens(usage: TokenUsage): string {
  const total = usage.inputTokens + usage.outputTokens;
  return `${formatTokenCount(total)} tokens`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
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
      return `${green("✅ Done")} ${dim("(")}${details}${dim(")")}`;
    case "loop_done":
      return `${boldGreen("🏁 LOOP_DONE")} ${dim("(")}${details}${dim(")")}`;
    case "max_reached":
      return `${yellow("⚠️ MAX reached")} ${dim("(")}${details}${dim(")")}`;
  }
}

export function formatRunSummary(summary: RunSummary): string {
  const sep = dim(" · ");
  const parts = [
    dim(formatDuration(summary.totalDurationMs)),
    green(`$${summary.totalCostUsd.toFixed(2)}`),
    cyan(formatTokens(summary.totalUsage)),
  ];
  return `${dim("Total:")} ${parts.join(sep)}`;
}

export function formatRetry(attempt: number, maxRetries: number, error: string): string {
  return dim(`↻ Retry ${attempt}/${maxRetries} (${error})`);
}

export function formatError(message: string): string {
  return boldRed(`✗ Error: ${message}`);
}

export function formatUserMessage(text: string): string {
  return cyan(`👤 ${text}`);
}
