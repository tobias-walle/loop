import { CURSOR_MARKER, type Component, type Focusable, visibleWidth } from "@mariozechner/pi-tui";
import { cyan, dim, dimGray, green, yellow } from "./colors.js";
import { formatDuration } from "./event-log.js";

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
 *   Line 2: input field
 *   Line 3: separator + status footer
 */
export class StatusBar implements Component, Focusable {
  focused = false;
  onSubmit?: (message: string) => void;

  private inputValue = "";
  private cursorPos = 0;
  private status: StatusInfo = {};
  private queued = false;
  private startTime: number | null = null;

  setStatus(info: StatusInfo): void {
    this.status = info;
  }

  setStartTime(time: number): void {
    this.startTime = time;
  }

  setQueued(queued: boolean): void {
    this.queued = queued;
  }

  getInputValue(): string {
    return this.inputValue;
  }

  invalidate(): void {
    // No caching
  }

  render(width: number): string[] {
    const sep = dimGray("─".repeat(width));
    const inputLine = this.buildInputLine(width);
    const footerLine = this.buildFooterLine(width);
    return ["", sep, inputLine, sep, footerLine];
  }

  private buildInputLine(width: number): string {
    if (this.focused) {
      const before = this.inputValue.slice(0, this.cursorPos);
      const after = this.inputValue.slice(this.cursorPos);
      // Thin line cursor: dimGray "▏"
      const cursor = "\x1b[2;90m▏\x1b[0m";
      const inputPart = `${before}${CURSOR_MARKER}${cursor}${after}`;
      const contentWidth = visibleWidth(this.inputValue) + 1; // +1 for ▏
      const pad = Math.max(0, width - contentWidth);
      return `${inputPart}${" ".repeat(pad)}`;
    }
    const inputWidth = visibleWidth(this.inputValue);
    const pad = Math.max(0, width - inputWidth);
    return `${this.inputValue}${" ".repeat(pad)}`;
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

    if (this.queued) {
      parts.push(yellow("(queued)"));
    }

    const sep = dim(" \u00b7 ");
    const text = parts.length > 0 ? parts.join(sep) : "";
    const textWidth = visibleWidth(text);
    const pad = Math.max(0, width - textWidth);
    return `${text}${" ".repeat(pad)}`;
  }

  handleInput(data: string): void {
    // Enter
    if (data === "\r" || data === "\n") {
      if (this.inputValue.length > 0 && this.onSubmit) {
        this.onSubmit(this.inputValue);
        this.inputValue = "";
        this.cursorPos = 0;
      }
      return;
    }

    // Escape
    if (data === "\x1b" || data === "\x1b\x1b") {
      this.inputValue = "";
      this.cursorPos = 0;
      return;
    }

    // Backspace
    if (data === "\x7f" || data === "\b") {
      if (this.cursorPos > 0) {
        this.inputValue =
          this.inputValue.slice(0, this.cursorPos - 1) + this.inputValue.slice(this.cursorPos);
        this.cursorPos--;
      }
      return;
    }

    // Delete
    if (data === "\x1b[3~") {
      if (this.cursorPos < this.inputValue.length) {
        this.inputValue =
          this.inputValue.slice(0, this.cursorPos) + this.inputValue.slice(this.cursorPos + 1);
      }
      return;
    }

    // Left arrow
    if (data === "\x1b[D") {
      if (this.cursorPos > 0) this.cursorPos--;
      return;
    }

    // Right arrow
    if (data === "\x1b[C") {
      if (this.cursorPos < this.inputValue.length) this.cursorPos++;
      return;
    }

    // Home / Ctrl+A
    if (data === "\x1b[H" || data === "\x01") {
      this.cursorPos = 0;
      return;
    }

    // End / Ctrl+E
    if (data === "\x1b[F" || data === "\x05") {
      this.cursorPos = this.inputValue.length;
      return;
    }

    // Ignore other escape sequences
    if (data.startsWith("\x1b")) return;

    // Regular character input
    this.inputValue =
      this.inputValue.slice(0, this.cursorPos) + data + this.inputValue.slice(this.cursorPos);
    this.cursorPos += data.length;
  }
}
