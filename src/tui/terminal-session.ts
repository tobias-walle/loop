import { StdinBuffer, TUI, type Terminal } from "@mariozechner/pi-tui";
import {
  CLEAR_FROM_CURSOR,
  CLEAR_LINE,
  CLEAR_SCREEN,
  ENTER_ALT_SCREEN,
  ERASE_SCROLLBACK,
  HIDE_CURSOR,
  LEAVE_ALT_SCREEN,
  QUERY_CELL_SIZE,
  SHOW_CURSOR,
  moveCursorBy,
  setTerminalTitle,
} from "../lib/ansi.js";

interface BrowserInput {
  isRaw?: boolean;
  setRawMode?(value: boolean): void;
  on(event: "data", listener: (data: string | Buffer) => void): unknown;
  off(event: "data", listener: (data: string | Buffer) => void): unknown;
  resume(): void;
  pause(): void;
}

interface BrowserOutput {
  columns?: number;
  rows?: number;
  write(text: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

interface ProcessEvents {
  on(event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): unknown;
  off(event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): unknown;
}

export interface TerminalSessionOptions {
  stdin?: BrowserInput;
  stdout?: BrowserOutput;
  process?: ProcessEvents;
  createTui?: (terminal: Terminal) => TUI;
}

export interface TerminalSession extends Disposable {
  readonly tui: TUI;
  readonly terminal: Terminal;
}

class BrowserTerminal implements Terminal {
  private readonly buffer = new StdinBuffer();
  private inputCallback?: (data: string) => void;
  private resizeCallback?: () => void;
  private started = false;
  private previousRaw = false;
  private readonly onData = (data: string | Buffer): void => this.buffer.process(data);
  private readonly onResize = (): void => this.resizeCallback?.();

  constructor(
    private readonly input: BrowserInput,
    private readonly output: BrowserOutput,
  ) {}

  get columns(): number {
    return Math.max(1, this.output.columns ?? 80);
  }

  get rows(): number {
    return Math.max(1, this.output.rows ?? 24);
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    if (this.started) return;
    this.started = true;
    this.inputCallback = onInput;
    this.resizeCallback = onResize;
    this.previousRaw = this.input.isRaw === true;
    this.buffer.on("data", onInput);
    this.input.on("data", this.onData);
    this.output.on("resize", this.onResize);
    this.input.setRawMode?.(true);
    this.input.resume();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.inputCallback) this.buffer.off("data", this.inputCallback);
    this.buffer.destroy();
    this.input.off("data", this.onData);
    this.output.off("resize", this.onResize);
    this.input.setRawMode?.(this.previousRaw);
    this.input.pause();
    this.inputCallback = undefined;
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

class OwnedTerminalSession implements TerminalSession {
  private disposed = false;
  private started = false;
  private readonly monitor = (): void => this.dispose();

  constructor(
    readonly terminal: Terminal,
    readonly tui: TUI,
    private readonly output: BrowserOutput,
    private readonly processEvents: ProcessEvents,
  ) {}

  start(): void {
    this.output.write(ENTER_ALT_SCREEN);
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
    if (this.started) {
      try {
        this.tui.stop();
      } catch {}
    } else {
      try {
        this.terminal.stop();
      } catch {}
    }
    try {
      this.output.write(LEAVE_ALT_SCREEN);
    } catch {}
  }
}

export function openTerminalSession(options: TerminalSessionOptions = {}): TerminalSession {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const processEvents = options.process ?? process;
  const terminal = new BrowserTerminal(stdin, stdout);
  const tui = options.createTui?.(terminal) ?? new TUI(terminal);
  const session = new OwnedTerminalSession(terminal, tui, stdout, processEvents);
  session.start();
  return session;
}
