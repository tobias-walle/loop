import { type Component, type Focusable, truncateToWidth } from "@mariozechner/pi-tui";
import { cyan, dim, dimGray, green } from "../../lib/ansi.js";
import type { TokenUsage } from "../../lib/types.js";
import { formatDuration, formatTokens } from "../formatters.js";
import { InputLine } from "./input-line.js";

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

/**
 * Bottom overlay:
 *   Line 1: separator (─── full width)
 *   Line 2: input field (delegated to InputLine)
 *   Line 3: separator
 *   Line 4: cumulative run stats
 */
export class StatusBar implements Component, Focusable {
  focused = false;

  readonly input = new InputLine();

  private status: StatusInfo = {};
  private startTime: number | null = null;
  private hidden = false;

  get onSubmit(): ((message: string) => void) | undefined {
    return this.input.onSubmit;
  }
  set onSubmit(fn: ((message: string) => void) | undefined) {
    this.input.onSubmit = fn;
  }

  get onInterrupt(): (() => void) | undefined {
    return this.input.onInterrupt;
  }
  set onInterrupt(fn: (() => void) | undefined) {
    this.input.onInterrupt = fn;
  }

  setStatus(info: StatusInfo): void {
    this.status = info;
  }

  setStartTime(time: number): void {
    this.startTime = time;
  }

  hide(): void {
    this.hidden = true;
  }

  getInputValue(): string {
    return this.input.getValue();
  }

  invalidate(): void {
    // No caching
  }

  render(width: number): string[] {
    if (this.hidden) return [];
    this.input.focused = this.focused;
    const sep = dimGray("─".repeat(width));
    const inputLines = this.input.render(width);
    const footerLine = this.buildFooterLine(width);
    return ["", sep, ...inputLines, sep, footerLine];
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  private buildFooterLine(width: number): string {
    const parts: string[] = [];
    const s = this.status;

    const durationMs = this.startTime != null ? Date.now() - this.startTime : s.durationMs;
    if (durationMs != null) {
      parts.push(dim(formatDuration(durationMs)));
    }

    if (s.costUsd != null) {
      const cost =
        s.currentSessionCostUsd != null
          ? `$${s.currentSessionCostUsd.toFixed(2)} / $${s.costUsd.toFixed(2)}`
          : `$${s.costUsd.toFixed(2)}`;
      parts.push(green(cost));
    }

    if (s.usage != null) {
      const tokens =
        s.currentSessionUsage != null
          ? `${formatTokens(s.currentSessionUsage).replace(" tokens", "")} / ${formatTokens(s.usage)}`
          : formatTokens(s.usage);
      parts.push(cyan(tokens));
    }

    const sep = dim(" · ");
    const text = parts.length > 0 ? parts.join(sep) : "";
    return truncateToWidth(text, width, "", true);
  }
}
