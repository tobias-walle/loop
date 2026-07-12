import { type Component, type Focusable, truncateToWidth } from "@mariozechner/pi-tui";
import { cyan, dim, dimGray, green } from "../../lib/ansi.js";
import type { TokenUsage } from "../../lib/types.js";
import { formatDuration, formatTokens } from "../formatters.js";

const CTRL_C = String.fromCharCode(3);
const ESC = String.fromCharCode(27);
const KITTY_CTRL_C = `${ESC}[99;5u`;

interface StatusInfo {
  step?: number;
  totalSteps?: number;
  iteration?: number;
  max?: number;
  costUsd?: number;
  currentSessionCostUsd?: number;
  durationMs?: number;
  usage?: TokenUsage;
  currentSessionUsage?: TokenUsage;
}

/** Bottom overlay with run stats and minimal Ctrl+C handling. */
export class StatusBar implements Component, Focusable {
  focused = false;

  onInterrupt: (() => void) | undefined;

  private status: StatusInfo = {};
  private startTime: number | null = null;
  private hidden = false;

  setStatus(info: StatusInfo): void {
    this.status = info;
  }

  setStartTime(time: number): void {
    this.startTime = time;
  }

  hide(): void {
    this.hidden = true;
  }

  invalidate(): void {
    // No caching
  }

  render(width: number): string[] {
    if (this.hidden) return [];
    const sep = dimGray("─".repeat(width));
    const footerLine = this.buildFooterLine(width);
    return ["", sep, footerLine];
  }

  handleInput(data: string): void {
    if (data === CTRL_C || data === KITTY_CTRL_C) {
      this.onInterrupt?.();
    }
  }

  private buildFooterLine(width: number): string {
    const parts: string[] = [];
    const s = this.status;

    const durationMs = this.startTime != null ? Date.now() - this.startTime : s.durationMs;
    if (durationMs != null) {
      parts.push(dim(formatDuration(durationMs)));
    }

    if (s.costUsd != null) {
      const total = `$${s.costUsd.toFixed(2)}`;
      const current =
        s.currentSessionCostUsd != null ? `$${s.currentSessionCostUsd.toFixed(2)}` : undefined;
      parts.push(green(current && current !== total ? `${current} | ${total}` : total));
    }

    if (s.usage != null) {
      const total = formatTokens(s.usage);
      const current = s.currentSessionUsage
        ? formatTokens(s.currentSessionUsage).replace(" tokens", "")
        : undefined;
      parts.push(cyan(current && `${current} tokens` !== total ? `${current} | ${total}` : total));
    }

    const sep = dim(" · ");
    const text = parts.length > 0 ? parts.join(sep) : "";
    return truncateToWidth(text, width, "", true);
  }
}
