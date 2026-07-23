import { describe, expect, test } from "bun:test";
import type { TUI, Terminal } from "@mariozechner/pi-tui";
import {
  ENTER_ALT_SCREEN,
  ERASE_SCROLLBACK,
  LEAVE_ALT_SCREEN,
  QUERY_CELL_SIZE,
} from "../lib/ansi.js";
import { openInlineTerminalSession } from "./inline-terminal-session.js";

class RecordingOutput {
  isTTY = true;
  columns = 100;
  rows = 30;
  text = "";
  readonly resizeListeners = new Set<() => void>();

  write(text: string): void {
    this.text += text;
  }

  on(event: "resize", listener: () => void): void {
    if (event === "resize") this.resizeListeners.add(listener);
  }

  off(event: "resize", listener: () => void): void {
    if (event === "resize") this.resizeListeners.delete(listener);
  }
}

class RecordingProcess {
  readonly monitors = new Set<(...args: unknown[]) => void>();

  on(_event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): void {
    this.monitors.add(listener);
  }

  off(_event: "uncaughtExceptionMonitor", listener: (...args: unknown[]) => void): void {
    this.monitors.delete(listener);
  }
}

function fakeTui(terminal: Terminal, calls: string[]): TUI {
  return {
    start() {
      calls.push("tui:start");
      terminal.start(
        () => {},
        () => calls.push("resize"),
      );
      terminal.hideCursor();
    },
    stop() {
      calls.push("tui:stop");
      terminal.showCursor();
      terminal.stop();
    },
  } as TUI;
}

describe("inline terminal session", () => {
  test("starts an output-only TUI without alternate-screen controls", () => {
    const output = new RecordingOutput();
    const processEvents = new RecordingProcess();
    const calls: string[] = [];

    using _session = openInlineTerminalSession({
      stdout: output,
      process: processEvents,
      createTui: (terminal) => fakeTui(terminal, calls),
    });

    expect(calls).toEqual(["tui:start"]);
    expect(output.text).not.toContain(ENTER_ALT_SCREEN);
    expect(output.text).not.toContain(LEAVE_ALT_SCREEN);
    expect(output.resizeListeners.size).toBe(1);
    expect(processEvents.monitors.size).toBe(1);
  });

  test("forwards resize and filters erase-scrollback from renderer writes", () => {
    const output = new RecordingOutput();
    const calls: string[] = [];
    using session = openInlineTerminalSession({
      stdout: output,
      process: new RecordingProcess(),
      createTui: (terminal) => fakeTui(terminal, calls),
    });

    output.resizeListeners.values().next().value?.();
    session.terminal.write(`before${ERASE_SCROLLBACK}${QUERY_CELL_SIZE}after`);

    expect(calls).toContain("resize");
    expect(output.text).toContain("beforeafter");
    expect(output.text).not.toContain(ERASE_SCROLLBACK);
    expect(output.text).not.toContain(QUERY_CELL_SIZE);
  });

  test("disposal restores the terminal and listeners exactly once", () => {
    const output = new RecordingOutput();
    const processEvents = new RecordingProcess();
    const calls: string[] = [];
    const session = openInlineTerminalSession({
      stdout: output,
      process: processEvents,
      createTui: (terminal) => fakeTui(terminal, calls),
    });

    session[Symbol.dispose]();
    session[Symbol.dispose]();

    expect(calls).toEqual(["tui:start", "tui:stop"]);
    expect(output.resizeListeners.size).toBe(0);
    expect(processEvents.monitors.size).toBe(0);
  });

  test("rolls back partial acquisition when TUI startup throws", () => {
    const output = new RecordingOutput();
    const processEvents = new RecordingProcess();

    expect(() =>
      openInlineTerminalSession({
        stdout: output,
        process: processEvents,
        createTui: (terminal) =>
          ({
            start() {
              terminal.start(
                () => {},
                () => {},
              );
              throw new Error("render failed");
            },
            stop() {},
          }) as TUI,
      }),
    ).toThrow("render failed");
    expect(output.resizeListeners.size).toBe(0);
    expect(processEvents.monitors.size).toBe(0);
  });
});
