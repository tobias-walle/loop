import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { SessionOverview } from "../../lib/session-store.js";
import { createBrowserModel, updateBrowser, withBrowserDetail } from "./model.js";
import { renderBrowser, stabilizeBrowserViewport } from "./view.js";

function plain(text: string): string {
  return text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: test strips terminal CSI controls
    /\x1b\[[0-?]*[ -/]*[@-~]/g,
    "",
  );
}

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

describe("browser view", () => {
  test("renders a styled overview with a visible footer within dimensions", () => {
    const lines = renderBrowser(createBrowserModel([session]), { columns: 40, rows: 6 });
    const rendered = lines.join("\n");
    expect(lines).toHaveLength(6);
    expect(rendered).toContain("\x1b[");
    expect(plain(rendered)).toContain("Work");
    expect(plain(lines.at(-1) ?? "")).toContain("exit");
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  test("separates overview sessions with an empty row", () => {
    const sessions = [
      { ...session, id: "one", title: "First", sessionDir: "/session/one" },
      { ...session, id: "two", title: "Second", sessionDir: "/session/two" },
    ];
    const lines = renderBrowser(createBrowserModel(sessions), { columns: 40, rows: 8 }).map(plain);

    expect(lines.slice(1, 6)).toEqual([
      "> First",
      "  aborted · 0/? steps · resumable",
      "",
      "  Second",
      "  aborted · 0/? steps · resumable",
    ]);
  });

  test("keeps the selected overview session visible", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      ...session,
      id: String(index),
      title: `Session ${index}`,
      sessionDir: `/session/${index}`,
    }));
    let model = createBrowserModel(sessions);
    model = updateBrowser(model, { type: "last" }).model;
    const lines = renderBrowser(model, { columns: 40, rows: 6 });
    expect(plain(lines.join("\n"))).toContain("> Session 9");
    expect(plain(lines.at(-1) ?? "")).toContain("exit");
  });

  test("renders a fixed-height detail viewport and end never produces an empty frame", () => {
    let model = updateBrowser(createBrowserModel([session]), { type: "open" }).model;
    model = withBrowserDetail(model, {
      warnings: [],
      lines: Array.from({ length: 30 }, (_, index) => `line ${index}`),
    });
    model = updateBrowser(model, { type: "last" }).model;
    const lines = renderBrowser(model, { columns: 20, rows: 8 });
    expect(lines).toHaveLength(8);
    expect(plain(lines.join("\n"))).toContain("line 29");
    expect(plain(lines.at(-1) ?? "")).toContain("back");
  });

  test("anchors the visible event across resize", () => {
    let model = updateBrowser(createBrowserModel([session]), { type: "open" }).model;
    model = withBrowserDetail(model, {
      warnings: [],
      lines: ["first short", "second line that wraps at narrow widths", "third"],
    });
    model = updateBrowser(model, { type: "down" }).model;
    model = stabilizeBrowserViewport(model, { columns: 40, rows: 4 });
    expect(model.detail?.viewport.anchorEventId).toBe("legacy-1");
    const resized = renderBrowser(model, { columns: 12, rows: 4 });
    expect(plain(resized.join("\n"))).toContain("second");
  });

  test("tiny dimensions remain valid", () => {
    expect(() => renderBrowser(createBrowserModel([]), { columns: 1, rows: 1 })).not.toThrow();
    expect(renderBrowser(createBrowserModel([]), { columns: 1, rows: 1 })).toHaveLength(1);
  });
});
