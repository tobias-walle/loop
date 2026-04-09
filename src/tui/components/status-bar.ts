import { type Component, type Focusable, truncateToWidth } from "@mariozechner/pi-tui";
import { cyan, dim, dimGray, green, yellow } from "../../lib/ansi.js";
import { formatDuration } from "../formatters.js";
import { InputLine } from "./input-line.js";

interface StatusInfo {
  step?: number;
  totalSteps?: number;
  iteration?: number;
  max?: number;
  costUsd?: number;
  durationMs?: number;
}

/**
 * Three-line bottom overlay:
 *   Line 1: separator (─── full width)
 *   Line 2: input field (delegated to InputLine)
 *   Line 3: separator + status footer
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

    if (s.step != null && s.totalSteps != null) {
      parts.push(cyan(`step ${s.step}/${s.totalSteps}`));
    }

    if (s.iteration != null) {
      const iterStr = s.max != null ? `iter ${s.iteration}/${s.max}` : `iter ${s.iteration}`;
      parts.push(yellow(iterStr));
    }

    if (s.costUsd != null) {
      parts.push(green(`$${s.costUsd.toFixed(2)}`));
    }

    const durationMs = this.startTime != null ? Date.now() - this.startTime : s.durationMs;
    if (durationMs != null) {
      parts.push(dim(formatDuration(durationMs)));
    }

    const sep = dim(" \u00b7 ");
    const text = parts.length > 0 ? parts.join(sep) : "";
    return truncateToWidth(text, width, "", true);
  }
}
