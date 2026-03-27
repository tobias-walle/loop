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
    case "Task": {
      const task = (input.task ?? input.description ?? "") as string;
      return `${boldMagenta("⚙ Subagent")} ${dim(truncate(`"${task}"`, maxWidth - 14))}`;
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

export function formatCompletion(
  type: "done" | "loop_done" | "max_reached",
  durationMs: number,
  iterations?: number,
): string {
  const dur = formatDuration(durationMs);
  switch (type) {
    case "done":
      return green(`✅ Done (${dur})`);
    case "loop_done": {
      const iterPart = iterations != null ? `${iterations} iterations, ` : "";
      return boldGreen(`🏁 LOOP_DONE (${iterPart}${dur})`);
    }
    case "max_reached": {
      const iterPart = iterations != null ? `${iterations} iterations, ` : "";
      return yellow(`⚠️ MAX reached (${iterPart}${dur})`);
    }
  }
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
