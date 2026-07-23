import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Terminal, TUI } from "@mariozechner/pi-tui";
import {
  ENTER_ALT_SCREEN,
  ERASE_SCROLLBACK,
  LEAVE_ALT_SCREEN,
  QUERY_CELL_SIZE,
} from "../lib/ansi.js";
import { openTerminalSession } from "./terminal-session.js";

class Output extends EventEmitter {
  columns = 80;
  rows = 24;
  writes: string[] = [];
  write(text: string): boolean {
    this.writes.push(text);
    return true;
  }
}

class ProcessEvents extends EventEmitter {}

class TestTerminal implements Terminal {
  readonly columns = 80;
  readonly rows = 24;
  readonly kittyProtocolActive = false;
  stopped = false;

  constructor(private readonly output: Output) {}

  start(_onInput: (data: string) => void, _onResize: () => void): void {}
  stop(): void {
    this.stopped = true;
  }
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.output.write(data);
  }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
}

function fixture(options: { throwOnStart?: boolean } = {}) {
  const output = new Output();
  const process = new ProcessEvents();
  const lifecycle: string[] = [];
  const terminal = new TestTerminal(output);
  const createTui = (createdTerminal: Terminal): TUI =>
    ({
      start() {
        lifecycle.push("start");
        if (options.throwOnStart) throw new Error("startup failed");
        createdTerminal.start(
          () => {},
          () => {},
        );
        createdTerminal.write("render");
      },
      stop() {
        lifecycle.push("stop");
        createdTerminal.stop();
      },
    }) as unknown as TUI;
  return { terminal, stdout: output, output, process, lifecycle, createTui };
}

describe("terminal session", () => {
  test("enters alternate screen before TUI startup without filtering terminal writes", () => {
    const item = fixture();
    using session = openTerminalSession(item);
    session.terminal.write(`before${ERASE_SCROLLBACK}${QUERY_CELL_SIZE}after`);

    expect(item.output.writes[0]).toBe(ENTER_ALT_SCREEN);
    expect(item.output.writes).toContain("render");
    expect(item.output.writes).toContain(`before${ERASE_SCROLLBACK}${QUERY_CELL_SIZE}after`);
  });

  test("stops TUI before leaving alternate screen and disposes once", () => {
    const item = fixture();
    const session = openTerminalSession(item);
    session[Symbol.dispose]();
    session[Symbol.dispose]();

    expect(item.lifecycle).toEqual(["start", "stop"]);
    expect(item.output.writes.at(-1)).toBe(LEAVE_ALT_SCREEN);
    expect(item.output.writes.filter((write) => write === LEAVE_ALT_SCREEN)).toHaveLength(1);
    expect(item.terminal.stopped).toBe(true);
  });

  test("rolls startup back and removes acquired listeners", () => {
    const item = fixture({ throwOnStart: true });
    expect(() => openTerminalSession(item)).toThrow("startup failed");
    expect(item.output.writes).toEqual([ENTER_ALT_SCREEN, LEAVE_ALT_SCREEN]);
    expect(item.terminal.stopped).toBe(true);
    expect(item.process.listenerCount("uncaughtExceptionMonitor")).toBe(0);
  });

  test("emergency monitor restores without consuming the error", () => {
    const item = fixture();
    const session = openTerminalSession(item);
    expect(item.process.listenerCount("uncaughtExceptionMonitor")).toBe(1);
    item.process.emit("uncaughtExceptionMonitor", new Error("render failed"), "uncaughtException");

    expect(item.output.writes.at(-1)).toBe(LEAVE_ALT_SCREEN);
    expect(item.process.listenerCount("uncaughtExceptionMonitor")).toBe(0);
    session[Symbol.dispose]();
  });
});
