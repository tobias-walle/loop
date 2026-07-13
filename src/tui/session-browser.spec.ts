import { describe, expect, test } from "bun:test";
import type { SessionOverview } from "../lib/session-store.js";
import { createSessionBrowser } from "./session-browser.js";

const session: SessionOverview = {
  sessionDir: "/state/sessions/project/id",
  id: "id",
  projectRoot: "/project",
  title: "Fix tests",
  status: "aborted",
  agent: "claude",
  createdAt: "2026-07-12T14:30:00.000Z",
  updatedAt: "2026-07-12T14:31:00.000Z",
  completedSteps: 1,
  totalSteps: 3,
  attemptCount: 1,
  totals: {
    totalCostUsd: 0.31,
    totalDurationMs: 1000,
    totalUsage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 },
  },
  canResume: true,
  interrupted: true,
  lock: { health: "unlocked" },
  legacy: false,
};

const emptyHistory = {
  replay: () => {},
  render: () => [] as string[],
  reset: () => {},
};

function plain(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("session browser", () => {
  test("uses the run TUI color language and vim navigation", () => {
    const second = { ...session, id: "newer", title: "Ship release" };
    let historyLines: string[] = [];
    const browser = createSessionBrowser({
      sessions: [session, second],
      loadDetail: (item) => ({ warnings: [item.title] }),
      history: {
        replay: (detail) => {
          historyLines = detail.warnings;
        },
        render: () => historyLines,
        reset: () => {
          historyLines = [];
        },
      },
      onResume: () => {},
      onExit: () => {},
      onDeleteLock: () => {},
    });

    const overview = browser.render(100).join("\n");
    expect(overview).toContain("\x1b[1;36m");
    expect(overview).toContain("\x1b[32m");
    expect(plain(overview)).toContain("j/k select");

    browser.handleInput("j");
    browser.handleInput("\r");
    expect(plain(browser.render(100).join("\n"))).toContain("Ship release");
    browser.handleInput("\x1b");
    browser.handleInput("G");
    browser.handleInput("\r");
    expect(plain(browser.render(100).join("\n"))).toContain("Ship release");
    browser.handleInput("\x1b");
    browser.handleInput("g");
    browser.handleInput("\r");
    expect(plain(browser.render(100).join("\n"))).toContain("Fix tests");
  });

  test("renders exact run history with hints and keeps it mounted for resume", () => {
    let replayed = 0;
    let reset = 0;
    const resumed: string[] = [];
    const browser = createSessionBrowser({
      sessions: [session],
      loadDetail: () => ({ warnings: [] }),
      history: {
        replay: () => replayed++,
        render: () => [
          "session id",
          "",
          "[step 01/03 · claude · sonnet]",
          "Fix tests",
          "› inspected the failure",
          "◇ read   src/index.ts",
        ],
        reset: () => reset++,
      },
      onResume: (item) => resumed.push(item.id),
      onExit: () => {},
      onDeleteLock: () => {},
    });

    browser.handleInput("\r");
    const output = plain(browser.render(100).join("\n"));
    expect(replayed).toBe(1);
    expect(output).toContain("[step 01/03 · claude · sonnet]");
    expect(output).toContain("◇ read   src/index.ts");
    expect(output).toContain("j/k scroll");
    expect(output).not.toContain("Project:");
    expect(output).not.toContain("Filesystem or tool side effects");

    browser.handleInput("\r");
    expect(resumed).toEqual(["id"]);
    expect(reset).toBe(0);
  });

  test("renders projected legacy history lines", () => {
    const browser = createSessionBrowser({
      sessions: [{ ...session, legacy: true, canResume: false }],
      loadDetail: () => ({ warnings: [], lines: ["legacy output"] }),
      history: emptyHistory,
      onResume: () => {},
      onExit: () => {},
      onDeleteLock: () => {},
    });

    browser.handleInput("\r");

    expect(plain(browser.render(80).join("\n"))).toContain("legacy output");
  });

  test("opens detail, returns with Escape, and resumes with Enter", () => {
    const resumed: string[] = [];
    const browser = createSessionBrowser({
      sessions: [session],
      loadDetail: () => ({ warnings: [] }),
      history: {
        ...emptyHistory,
        render: () => ["session id", "[step 01/03 · claude]", "Fix tests", "▲ interrupted"],
      },
      onResume: (item) => resumed.push(item.id),
      onExit: () => {},
      onDeleteLock: () => {},
    });

    expect(browser.render(100).join("\n")).toContain("Resume a session");
    browser.handleInput("\r");
    const detail = browser.render(100).join("\n");
    expect(detail).toContain("Fix tests");
    expect(detail).toContain("▲ interrupted");

    browser.handleInput("\r");
    expect(resumed).toEqual(["id"]);
    browser.handleInput("\x1b");
    expect(browser.render(100).join("\n")).toContain("Resume a session");
  });

  test("keeps content visible when scrolling past the end", () => {
    const browser = createSessionBrowser({
      sessions: [session],
      loadDetail: () => ({ warnings: [] }),
      history: {
        ...emptyHistory,
        render: () => ["first", "last"],
      },
      onResume: () => {},
      onExit: () => {},
      onDeleteLock: () => {},
    });

    browser.handleInput("\r");
    for (let index = 0; index < 20; index++) browser.handleInput("j");

    expect(plain(browser.render(80).join("\n"))).toContain("q/h/Esc back");
  });

  test("End jumps to the latest history instead of rendering an empty screen", () => {
    const browser = createSessionBrowser({
      sessions: [session],
      loadDetail: () => ({ warnings: [] }),
      history: {
        ...emptyHistory,
        render: () => Array.from({ length: 30 }, (_, index) => `line ${index}`),
      },
      onResume: () => {},
      onExit: () => {},
      onDeleteLock: () => {},
    });

    browser.handleInput("\r");
    browser.handleInput("\x1b[F");

    expect(browser.render(80).join("\n")).toContain("line 29");
  });

  test("offers lock deletion from replay history", () => {
    const browser = createSessionBrowser({
      sessions: [{ ...session, lock: { health: "unknown", error: "Malformed lock" } }],
      loadDetail: () => ({ warnings: [] }),
      history: emptyHistory,
      onResume: () => {},
      onExit: () => {},
      onDeleteLock: () => {},
    });

    browser.handleInput("\r");
    const output = browser.render(120).join("\n");
    expect(plain(output)).toContain("D delete lock");
  });

  test("explains why a session cannot resume", () => {
    const browser = createSessionBrowser({
      sessions: [
        { ...session, canResume: false, disabledReason: "No unfinished workflow remains." },
      ],
      loadDetail: () => ({ warnings: [] }),
      history: emptyHistory,
      onResume: () => {
        throw new Error("must not resume");
      },
      onExit: () => {},
      onDeleteLock: () => {},
    });

    browser.handleInput("\r");
    const output = browser.render(80).join("\n");
    expect(output).toContain("No unfinished workflow remains.");
    browser.handleInput("\r");
  });
});
