import { ProcessTerminal, type Terminal, TUI } from "@mariozechner/pi-tui";
import { ENTER_ALT_SCREEN, LEAVE_ALT_SCREEN } from "../lib/ansi.js";

interface TerminalOutput {
  write(text: string): unknown;
}

interface ProcessEvents {
  on(event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): unknown;
  off(event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): unknown;
}

export interface TerminalSessionOptions {
  terminal?: Terminal;
  stdout?: TerminalOutput;
  process?: ProcessEvents;
  createTui?: (terminal: Terminal) => TUI;
}

export interface TerminalSession extends Disposable {
  readonly tui: TUI;
  readonly terminal: Terminal;
}

class OwnedTerminalSession implements TerminalSession {
  private disposed = false;
  private started = false;
  private readonly monitor = (): void => this.dispose();

  constructor(
    readonly terminal: Terminal,
    readonly tui: TUI,
    private readonly output: TerminalOutput,
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
  const stdout = options.stdout ?? process.stdout;
  const processEvents = options.process ?? process;
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = options.createTui?.(terminal) ?? new TUI(terminal);
  const session = new OwnedTerminalSession(terminal, tui, stdout, processEvents);
  session.start();
  return session;
}
