import { CURSOR_MARKER, type Component, type Focusable, visibleWidth } from "@mariozechner/pi-tui";
import {
  KEY_BACKSPACE,
  KEY_BACKSPACE_ALT,
  KEY_CTRL_A,
  KEY_CTRL_E,
  KEY_DELETE,
  KEY_END,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_ESCAPE_DOUBLE,
  KEY_HOME,
  KEY_LEFT,
  KEY_NEWLINE,
  KEY_RIGHT,
  cursorStyle,
  cyan,
  dim,
  dimGray,
  green,
  yellow,
} from "../../lib/ansi.js";
import { formatDuration } from "../formatters.js";

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

  getInputValue(): string {
    return this.inputValue;
  }

  invalidate(): void {
    // No caching
  }

  render(width: number): string[] {
    if (this.hidden) return [];
    const sep = dimGray("─".repeat(width));
    const inputLine = this.buildInputLine(width);
    const footerLine = this.buildFooterLine(width);
    return ["", sep, inputLine, sep, footerLine];
  }

  private buildInputLine(width: number): string {
    if (this.focused) {
      const before = this.inputValue.slice(0, this.cursorPos);
      const after = this.inputValue.slice(this.cursorPos);
      const cursor = cursorStyle();
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

    const sep = dim(" \u00b7 ");
    const text = parts.length > 0 ? parts.join(sep) : "";
    const textWidth = visibleWidth(text);
    const pad = Math.max(0, width - textWidth);
    return `${text}${" ".repeat(pad)}`;
  }

  private keyHandlers: ReadonlyMap<string, () => void> = new Map<string, () => void>([
    [KEY_ENTER, () => this.submitInput()],
    [KEY_NEWLINE, () => this.submitInput()],
    [KEY_ESCAPE, () => this.clearInput()],
    [KEY_ESCAPE_DOUBLE, () => this.clearInput()],
    [KEY_BACKSPACE, () => this.deleteBack()],
    [KEY_BACKSPACE_ALT, () => this.deleteBack()],
    [KEY_DELETE, () => this.deleteForward()],
    [KEY_LEFT, () => this.moveCursorLeft()],
    [KEY_RIGHT, () => this.moveCursorRight()],
    [KEY_HOME, () => this.moveCursorHome()],
    [KEY_CTRL_A, () => this.moveCursorHome()],
    [KEY_END, () => this.moveCursorEnd()],
    [KEY_CTRL_E, () => this.moveCursorEnd()],
  ]);

  handleInput(data: string): void {
    const handler = this.keyHandlers.get(data);
    if (handler) {
      handler();
      return;
    }

    // Ignore other escape sequences
    if (data.startsWith(KEY_ESCAPE)) return;

    // Regular character input
    this.inputValue =
      this.inputValue.slice(0, this.cursorPos) + data + this.inputValue.slice(this.cursorPos);
    this.cursorPos += data.length;
  }

  private submitInput(): void {
    if (this.inputValue.length > 0 && this.onSubmit) {
      this.onSubmit(this.inputValue);
      this.inputValue = "";
      this.cursorPos = 0;
    }
  }

  private clearInput(): void {
    this.inputValue = "";
    this.cursorPos = 0;
  }

  private deleteBack(): void {
    if (this.cursorPos > 0) {
      this.inputValue =
        this.inputValue.slice(0, this.cursorPos - 1) + this.inputValue.slice(this.cursorPos);
      this.cursorPos--;
    }
  }

  private deleteForward(): void {
    if (this.cursorPos < this.inputValue.length) {
      this.inputValue =
        this.inputValue.slice(0, this.cursorPos) + this.inputValue.slice(this.cursorPos + 1);
    }
  }

  private moveCursorLeft(): void {
    if (this.cursorPos > 0) this.cursorPos--;
  }

  private moveCursorRight(): void {
    if (this.cursorPos < this.inputValue.length) this.cursorPos++;
  }

  private moveCursorHome(): void {
    this.cursorPos = 0;
  }

  private moveCursorEnd(): void {
    this.cursorPos = this.inputValue.length;
  }
}
