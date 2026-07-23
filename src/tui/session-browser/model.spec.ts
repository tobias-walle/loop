import { describe, expect, test } from "bun:test";
import type { SessionOverview } from "../../lib/session-store.js";
import { createBrowserModel, updateBrowser } from "./model.js";

function session(overrides: Partial<SessionOverview> = {}): SessionOverview {
  return {
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
    ...overrides,
  };
}

describe("browser model", () => {
  test("keeps overview selection in bounds and supports first and last", () => {
    let model = createBrowserModel([session(), session({ id: "two" })]);
    model = updateBrowser(model, { type: "up" }).model;
    expect(model.selectedIndex).toBe(0);
    model = updateBrowser(model, { type: "last" }).model;
    expect(model.selectedIndex).toBe(1);
    model = updateBrowser(model, { type: "down" }).model;
    expect(model.selectedIndex).toBe(1);
    expect(updateBrowser(model, { type: "first" }).model.selectedIndex).toBe(0);
  });

  test("opens, navigates viewport, follows end, and returns", () => {
    let model = createBrowserModel([session()]);
    const opened = updateBrowser(model, { type: "open" });
    expect(opened.effect).toEqual({ type: "loadDetail", session: model.sessions[0] });
    model = opened.model;
    expect(model.mode).toBe("detail");
    model = updateBrowser(model, { type: "pageDown" }).model;
    expect(model.detail?.viewport.lineOffset).toBe(10);
    expect(model.detail?.viewport.follow).toBe(false);
    model = updateBrowser(model, { type: "last" }).model;
    expect(model.detail?.viewport.follow).toBe(true);
    expect(updateBrowser(model, { type: "back" }).model.mode).toBe("overview");
  });

  test("resumes only eligible details and confirms lock deletion", () => {
    let model = updateBrowser(createBrowserModel([session()]), { type: "open" }).model;
    expect(updateBrowser(model, { type: "resume" }).effect?.type).toBe("complete");
    model = updateBrowser(model, { type: "requestDelete" }).model;
    expect(model.detail?.confirmDelete).toBe(true);
    expect(updateBrowser(model, { type: "confirmDelete" }).effect?.type).toBe("deleteLock");
    expect(updateBrowser(model, { type: "cancelDelete" }).model.detail?.confirmDelete).toBe(false);
  });

  test("exits an empty overview", () => {
    const result = updateBrowser(createBrowserModel([]), { type: "exit" });
    expect(result.effect).toEqual({ type: "complete", result: { type: "exit", exitCode: 0 } });
  });
});
