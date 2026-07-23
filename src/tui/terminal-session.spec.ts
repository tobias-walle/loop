import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { TUI, Terminal } from "@mariozechner/pi-tui";
import {
  ENTER_ALT_SCREEN,
  ERASE_SCROLLBACK,
  LEAVE_ALT_SCREEN,
  QUERY_CELL_SIZE,
} from "../lib/ansi.js";
import { openTerminalSession } from "./terminal-session.js";

class Input extends EventEmitter {
  isRaw = false;
  setRawMode(value: boolean): void {
    this.isRaw = value;
  }
  resume(): void {}
  pause(): void {}
}

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

function fixture(options: { throwOnStart?: boolean } = {}) {
  const input = new Input();
  const output = new Output();
  const process = new ProcessEvents();
  const lifecycle: string[] = [];
  const createTui = (terminal: Terminal): TUI =>
    ({
      start() {
        lifecycle.push("start");
        if (options.throwOnStart) throw new Error("startup failed");
        terminal.start(
          () => {},
          () => {},
        );
        terminal.write("render");
      },
      stop() {
        lifecycle.push("stop");
        terminal.stop();
      },
    }) as unknown as TUI;
  return { stdin: input, stdout: output, input, output, process, lifecycle, createTui };
}

describe("terminal session", () => {
  test("enters alternate screen before TUI startup and filters scrollback erase", () => {
    const item = fixture();
    using session = openTerminalSession(item);
    session.terminal.write(`before${ERASE_SCROLLBACK}${QUERY_CELL_SIZE}after`);

    expect(item.output.writes[0]).toBe(ENTER_ALT_SCREEN);
    expect(item.output.writes).toContain("render");
    expect(item.output.writes).toContain("beforeafter");
    expect(item.output.writes.join("")).not.toContain(ERASE_SCROLLBACK);
    expect(item.output.writes.join("")).not.toContain(QUERY_CELL_SIZE);
  });

  test("stops TUI before leaving alternate screen and disposes once", () => {
    const item = fixture();
    const session = openTerminalSession(item);
    session[Symbol.dispose]();
    session[Symbol.dispose]();

    expect(item.lifecycle).toEqual(["start", "stop"]);
    expect(item.output.writes.at(-1)).toBe(LEAVE_ALT_SCREEN);
    expect(item.output.writes.filter((write) => write === LEAVE_ALT_SCREEN)).toHaveLength(1);
    expect(item.input.isRaw).toBe(false);
  });

  test("rolls startup back and removes acquired listeners", () => {
    const item = fixture({ throwOnStart: true });
    expect(() => openTerminalSession(item)).toThrow("startup failed");
    expect(item.output.writes).toEqual([ENTER_ALT_SCREEN, LEAVE_ALT_SCREEN]);
    expect(item.input.listenerCount("data")).toBe(0);
    expect(item.output.listenerCount("resize")).toBe(0);
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
