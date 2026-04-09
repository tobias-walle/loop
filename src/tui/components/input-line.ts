import {
  CURSOR_MARKER,
  type Component,
  type Focusable,
  decodeKittyPrintable,
  matchesKey,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { PASTE_END, PASTE_START, cursorStyle } from "../../lib/ansi.js";

export class InputLine implements Component, Focusable {
  focused = false;
  onSubmit?: (value: string) => void;
  onInterrupt?: () => void;

  private value = "";
  private cursorPos = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private savedInput = "";

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursorPos = Math.min(this.cursorPos, value.length);
  }

  invalidate(): void {
    // No caching
  }

  render(width: number): string[] {
    const cursor = this.focused ? this.cursorPos : -1;
    const { lines, cursorLine, cursorCol } = layoutLines(this.value, width, cursor);

    return lines.map((vLine, i) => {
      if (this.focused && i === cursorLine) {
        const before = vLine.slice(0, cursorCol);
        const after = vLine.slice(cursorCol);
        const rendered = `${before}${CURSOR_MARKER}${cursorStyle()}${after}`;
        return padLine(rendered, visibleWidth(vLine) + 1, width);
      }
      return padLine(vLine, visibleWidth(vLine), width);
    });
  }

  handleInput(data: string): void {
    // Handle bracketed paste
    if (data.includes(PASTE_START)) {
      let content = data.slice(data.indexOf(PASTE_START) + PASTE_START.length);
      const endIdx = content.indexOf(PASTE_END);
      if (endIdx !== -1) {
        content = content.slice(0, endIdx);
      }
      // Normalize line endings in pasted text
      content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      this.insertText(content);
      return;
    }

    // Newline: Shift+Enter (Kitty), Alt+Enter (legacy), or Ctrl+J (legacy)
    if (
      matchesKey(data, "shift+enter") ||
      matchesKey(data, "alt+enter") ||
      matchesKey(data, "ctrl+j")
    ) {
      this.insertText("\n");
      return;
    }
    if (matchesKey(data, "enter")) {
      this.submit();
      return;
    }
    if (matchesKey(data, "escape")) {
      this.clear();
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.deleteBack();
      return;
    }
    if (matchesKey(data, "delete")) {
      this.deleteForward();
      return;
    }
    if (matchesKey(data, "left")) {
      this.moveCursorLeft();
      return;
    }
    if (matchesKey(data, "right")) {
      this.moveCursorRight();
      return;
    }
    if (matchesKey(data, "up")) {
      this.historyBack();
      return;
    }
    if (matchesKey(data, "down")) {
      this.historyForward();
      return;
    }
    if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
      this.moveCursorHome();
      return;
    }
    if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
      this.moveCursorEnd();
      return;
    }
    if (matchesKey(data, "ctrl+c")) {
      this.handleCtrlC();
      return;
    }

    // Kitty CSI-u printable character decoding
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable !== undefined) {
      this.insertText(kittyPrintable);
      return;
    }

    // Regular character input — reject control characters
    const hasControlChars = Array.from(data).some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    });
    if (!hasControlChars) {
      this.insertText(data);
    }
  }

  private insertText(text: string): void {
    this.value = this.value.slice(0, this.cursorPos) + text + this.value.slice(this.cursorPos);
    this.cursorPos += text.length;
  }

  private submit(): void {
    if (this.value.length > 0 && this.onSubmit) {
      this.history.push(this.value);
      this.historyIndex = -1;
      this.savedInput = "";
      this.onSubmit(this.value);
      this.value = "";
      this.cursorPos = 0;
    }
  }

  private clear(): void {
    this.value = "";
    this.cursorPos = 0;
    this.historyIndex = -1;
    this.savedInput = "";
  }

  private handleCtrlC(): void {
    if (this.value.length > 0) {
      this.clear();
    } else {
      this.onInterrupt?.();
    }
  }

  private historyBack(): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === -1) {
      this.savedInput = this.value;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      return;
    }
    this.value = this.history[this.historyIndex];
    this.cursorPos = this.value.length;
  }

  private historyForward(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.value = this.history[this.historyIndex];
    } else {
      this.historyIndex = -1;
      this.value = this.savedInput;
      this.savedInput = "";
    }
    this.cursorPos = this.value.length;
  }

  private deleteBack(): void {
    if (this.cursorPos > 0) {
      this.value = this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
      this.cursorPos--;
    }
  }

  private deleteForward(): void {
    if (this.cursorPos < this.value.length) {
      this.value = this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1);
    }
  }

  private moveCursorLeft(): void {
    if (this.cursorPos > 0) this.cursorPos--;
  }

  private moveCursorRight(): void {
    if (this.cursorPos < this.value.length) this.cursorPos++;
  }

  private moveCursorHome(): void {
    this.cursorPos = 0;
  }

  private moveCursorEnd(): void {
    this.cursorPos = this.value.length;
  }
}

function padLine(content: string, contentWidth: number, width: number): string {
  const pad = Math.max(0, width - contentWidth);
  return pad > 0 ? `${content}${" ".repeat(pad)}` : content;
}

/** Split value into visual lines (hard newlines + soft wrap), tracking cursor position. */
function layoutLines(
  text: string,
  width: number,
  cursor: number,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const hardLines = text.split("\n");
  const lines: string[] = [];
  let cLine = -1;
  let cCol = -1;
  let offset = 0;

  for (let h = 0; h < hardLines.length; h++) {
    for (const wLine of softWrap(hardLines[h], width)) {
      if (cursor >= 0 && cLine === -1 && cursor >= offset && cursor <= offset + wLine.length) {
        cLine = lines.length;
        cCol = cursor - offset;
      }
      lines.push(wLine);
      offset += wLine.length;
    }
    if (h < hardLines.length - 1) {
      if (cursor === offset && cLine === -1) {
        cLine = lines.length - 1;
        cCol = lines[lines.length - 1].length;
      }
      offset += 1; // \n
    }
  }
  if (cursor >= 0 && cLine === -1) {
    cLine = lines.length - 1;
    cCol = lines[lines.length - 1].length;
  }
  return { lines, cursorLine: cLine, cursorCol: cCol };
}

function softWrap(line: string, width: number): string[] {
  if (width <= 0 || visibleWidth(line) <= width) return [line];
  const result: string[] = [];
  let remaining = line;
  while (remaining.length > 0) {
    if (visibleWidth(remaining) <= width) {
      result.push(remaining);
      break;
    }
    let breakAt = 0;
    for (let i = 1; i <= remaining.length; i++) {
      if (visibleWidth(remaining.slice(0, i)) > width) break;
      breakAt = i;
    }
    if (breakAt === 0) breakAt = 1;
    result.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return result.length > 0 ? result : [""];
}
