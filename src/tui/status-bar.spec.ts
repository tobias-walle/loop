import { describe, expect, it } from "bun:test";
import { StatusBar } from "./components/status-bar.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

function renderPlain(bar: StatusBar, width = 80): string[] {
  return bar.render(width).map(stripAnsi);
}

describe("StatusBar", () => {
  describe("render structure", () => {
    it("returns three lines: blank, separator, footer", () => {
      const bar = new StatusBar();
      const lines = bar.render(80);
      expect(lines).toHaveLength(3);
    });

    it("has separator and footer at bottom", () => {
      const bar = new StatusBar();
      bar.setStatus({
        step: 1,
        totalSteps: 2,
        costUsd: 0.05,
        durationMs: 10000,
        usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      const plain = renderPlain(bar);
      expect(plain[0]).toBe("");
      expect(plain[1]).toContain("─");
      expect(plain[2]).toContain("10s");
      expect(plain[2]).toContain("$0.05");
      expect(plain[2]).toContain("150 tokens");
      expect(plain[2]).not.toContain("step 1/2");
    });
  });

  describe("footer rendering", () => {
    it("does not render step or iteration info", () => {
      const bar = new StatusBar();
      bar.setStatus({ step: 2, totalSteps: 3, iteration: 1, max: 3 });
      const [, , footer] = renderPlain(bar);
      expect(footer).not.toContain("step 2/3");
      expect(footer).not.toContain("iter 1/3");
    });

    it("renders cost", () => {
      const bar = new StatusBar();
      bar.setStatus({ costUsd: 0.12 });
      const [, , footer] = renderPlain(bar);
      expect(footer).toContain("$0.12");
    });

    it("renders duration in seconds", () => {
      const bar = new StatusBar();
      bar.setStatus({ durationMs: 45000 });
      const [, , footer] = renderPlain(bar);
      expect(footer).toContain("45s");
    });

    it("renders duration in minutes and seconds", () => {
      const bar = new StatusBar();
      bar.setStatus({ durationMs: 134000 });
      const [, , footer] = renderPlain(bar);
      expect(footer).toContain("2m 14s");
    });

    it("renders token usage", () => {
      const bar = new StatusBar();
      bar.setStatus({
        usage: { inputTokens: 1500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      const [, , footer] = renderPlain(bar);
      expect(footer).toContain("2.0k tokens");
    });

    it("renders current session and total cost and tokens", () => {
      const bar = new StatusBar();
      bar.setStatus({
        costUsd: 0.11,
        currentSessionCostUsd: 0.03,
        usage: {
          inputTokens: 9000,
          outputTokens: 3000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        currentSessionUsage: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      });
      const [, , footer] = renderPlain(bar);
      expect(footer).toContain("$0.03 / $0.11");
      expect(footer).toContain("3.0k / 12.0k tokens");
    });
  });

  describe("ctrl+c behavior", () => {
    it("triggers interrupt", () => {
      const bar = new StatusBar();
      let interrupted = false;
      bar.onInterrupt = () => {
        interrupted = true;
      };
      bar.handleInput("\x03");
      expect(interrupted).toBe(true);
    });

    it("triggers interrupt for kitty protocol ctrl+c", () => {
      const bar = new StatusBar();
      let interrupted = false;
      bar.onInterrupt = () => {
        interrupted = true;
      };
      bar.handleInput("\x1b[99;5u");
      expect(interrupted).toBe(true);
    });
  });

  describe("hide", () => {
    it("returns empty lines when hidden", () => {
      const bar = new StatusBar();
      bar.hide();
      expect(bar.render(80)).toEqual([]);
    });
  });
});
