import { describe, expect, test } from "bun:test";
import type { Component, TUI, Terminal } from "@mariozechner/pi-tui";
import type { SessionOverview } from "../../lib/session-store.js";
import type { TerminalSession } from "../terminal-session.js";
import { browseSessions } from "./index.js";

const session: SessionOverview = {
  sessionDir: "/session",
  id: "one",
  title: "Work",
  status: "aborted",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  completedSteps: 0,
  attemptCount: 1,
  totals: {
    totalCostUsd: 0,
    totalDurationMs: 0,
    totalUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  },
  canResume: true,
  interrupted: true,
  lock: { health: "unlocked" },
  legacy: false,
};

function harness() {
  let component: Component | undefined;
  let disposed = false;
  const tui = {
    addChild(child: Component) {
      component = child;
    },
    setFocus() {},
    requestRender() {},
  } as unknown as TUI;
  const terminal = { columns: 80, rows: 24 } as Terminal;
  const session: TerminalSession = {
    tui,
    terminal,
    [Symbol.dispose]() {
      disposed = true;
    },
  };
  return { open: () => session, component: () => component, disposed: () => disposed };
}

describe("session browser integration", () => {
  test("opens detail, selects resume, and disposes before resolution", async () => {
    const item = harness();
    const result = browseSessions({
      sessions: [session],
      loadDetail: () => ({ warnings: [], lines: ["history"] }),
      deleteLock: () => {},
      openTerminal: item.open,
    });
    item.component()?.handleInput?.("\r");
    item.component()?.handleInput?.("\r");

    expect(await result).toEqual({ type: "resume", session });
    expect(item.disposed()).toBe(true);
  });

  test("u and d scroll the detail view by half a page", async () => {
    const item = harness();
    const result = browseSessions({
      sessions: [session],
      loadDetail: () => ({
        warnings: [],
        lines: Array.from({ length: 100 }, (_, index) => `line ${index}`),
      }),
      deleteLock: () => {},
      openTerminal: item.open,
    });
    item.component()?.handleInput?.("\r");

    expect(item.component()?.render(80)[1]).toBe("line 0");
    item.component()?.handleInput?.("d");
    expect(item.component()?.render(80)[1]).toBe("line 11");
    item.component()?.handleInput?.("u");
    expect(item.component()?.render(80)[1]).toBe("line 0");

    item.component()?.handleInput?.("\u0003");
    await result;
  });

  test("Ctrl+C exits from detail", async () => {
    const item = harness();
    const result = browseSessions({
      sessions: [session],
      loadDetail: () => ({ warnings: [], lines: ["history"] }),
      deleteLock: () => {},
      openTerminal: item.open,
    });
    item.component()?.handleInput?.("\r");
    item.component()?.handleInput?.("\u0003");
    expect(await result).toEqual({ type: "exit", exitCode: 130 });
    expect(item.disposed()).toBe(true);
  });

  test("q exits overview", async () => {
    const item = harness();
    const result = browseSessions({
      sessions: [],
      loadDetail: () => ({ warnings: [] }),
      deleteLock: () => {},
      openTerminal: item.open,
    });
    item.component()?.handleInput?.("q");
    expect(await result).toEqual({ type: "exit", exitCode: 0 });
    expect(item.disposed()).toBe(true);
  });
});
