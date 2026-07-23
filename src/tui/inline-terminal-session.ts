import { TUI, type Terminal } from "@mariozechner/pi-tui";
import {
  CLEAR_FROM_CURSOR,
  CLEAR_LINE,
  CLEAR_SCREEN,
  ERASE_SCROLLBACK,
  HIDE_CURSOR,
  QUERY_CELL_SIZE,
  SHOW_CURSOR,
  moveCursorBy,
  setTerminalTitle,
} from "../lib/ansi.js";

export interface InlineTerminalOutput {
  readonly columns?: number;
  readonly rows?: number;
  write(text: string): unknown;
  on?(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
}

interface ProcessEvents {
  on(event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): unknown;
  off(event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): unknown;
}

export interface InlineTerminalSessionOptions {
  stdout?: InlineTerminalOutput;
  process?: ProcessEvents;
  createTui?: (terminal: Terminal) => TUI;
}

export interface InlineTerminalSession extends Disposable {
  readonly tui: TUI;
  readonly terminal: Terminal;
}

class InlineTerminal implements Terminal {
  private resizeCallback?: () => void;
  private started = false;
  private readonly onResize = (): void => this.resizeCallback?.();

  constructor(private readonly output: InlineTerminalOutput) {}

  get columns(): number {
    return Math.max(1, this.output.columns ?? 80);
  }

  get rows(): number {
    return Math.max(1, this.output.rows ?? 24);
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  start(_onInput: (data: string) => void, onResize: () => void): void {
    if (this.started) return;
    this.started = true;
    this.resizeCallback = onResize;
    this.output.on?.("resize", this.onResize);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.output.off?.("resize", this.onResize);
    this.resizeCallback = undefined;
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.output.write(data.split(ERASE_SCROLLBACK).join("").split(QUERY_CELL_SIZE).join(""));
  }

  moveBy(lines: number): void {
    this.write(moveCursorBy(lines));
  }

  hideCursor(): void {
    this.write(HIDE_CURSOR);
  }

  showCursor(): void {
    this.write(SHOW_CURSOR);
  }

  clearLine(): void {
    this.write(CLEAR_LINE);
  }

  clearFromCursor(): void {
    this.write(CLEAR_FROM_CURSOR);
  }

  clearScreen(): void {
    this.write(CLEAR_SCREEN);
  }

  setTitle(title: string): void {
    this.write(setTerminalTitle(title));
  }
}

class OwnedInlineTerminalSession implements InlineTerminalSession {
  private disposed = false;
  private started = false;
  private readonly monitor = (): void => this.dispose();

  constructor(
    readonly terminal: Terminal,
    readonly tui: TUI,
    private readonly processEvents: ProcessEvents,
  ) {}

  start(): void {
    this.processEvents.on("uncaughtExceptionMonitor", this.monitor);
    try {
      this.tui.start();
      this.started = true;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.processEvents.off("uncaughtExceptionMonitor", this.monitor);
    try {
      if (this.started) this.tui.stop();
      else this.terminal.stop();
    } catch {}
  }
}

export function openInlineTerminalSession(
  options: InlineTerminalSessionOptions = {},
): InlineTerminalSession {
  const output = options.stdout ?? process.stdout;
  const processEvents = options.process ?? process;
  const terminal = new InlineTerminal(output);
  const tui = options.createTui?.(terminal) ?? new TUI(terminal);
  const session = new OwnedInlineTerminalSession(terminal, tui, processEvents);
  session.start();
  return session;
}
