import { describe, expect, it } from "bun:test";
import { CURSOR_MARKER } from "@mariozechner/pi-tui";
import { StatusBar } from "./components/status-bar.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "").replace(CURSOR_MARKER, "");
}

function renderPlain(bar: StatusBar, width = 80): string[] {
  return bar.render(width).map(stripAnsi);
}

describe("StatusBar", () => {
  describe("render structure", () => {
    it("returns five lines: blank, sep, input, sep, footer", () => {
      const bar = new StatusBar();
      bar.focused = true;
      const lines = bar.render(80);
      expect(lines).toHaveLength(5);
    });

    it("has separators above and below input, footer at bottom", () => {
      const bar = new StatusBar();
      bar.focused = true;
      bar.setStatus({ step: 1, totalSteps: 2, costUsd: 0.05, durationMs: 10000 });
      const plain = renderPlain(bar);
      expect(plain[0]).toBe(""); // blank spacer
      expect(plain[1]).toContain("─"); // top sep
      expect(plain[3]).toContain("─"); // bottom sep
      expect(plain[4]).toContain("step 1/2");
      expect(plain[4]).toContain("$0.05");
    });
  });

  describe("footer rendering", () => {
    it("renders step info", () => {
      const bar = new StatusBar();
      bar.setStatus({ step: 2, totalSteps: 3 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("step 2/3");
    });

    it("renders iteration info", () => {
      const bar = new StatusBar();
      bar.setStatus({ step: 1, totalSteps: 3, iteration: 3, max: 10 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("iter 3/10");
    });

    it("renders iteration without max", () => {
      const bar = new StatusBar();
      bar.setStatus({ step: 1, totalSteps: 1, iteration: 5 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("iter 5");
      expect(footer).not.toContain("iter 5/");
    });

    it("renders cost", () => {
      const bar = new StatusBar();
      bar.setStatus({ costUsd: 0.12 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("$0.12");
    });

    it("renders duration in seconds", () => {
      const bar = new StatusBar();
      bar.setStatus({ durationMs: 45000 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("45s");
    });

    it("renders duration in minutes and seconds", () => {
      const bar = new StatusBar();
      bar.setStatus({ durationMs: 134000 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("2m 14s");
    });
  });

  describe("input handling", () => {
    it("accepts typed characters", () => {
      const bar = new StatusBar();
      bar.focused = true;
      bar.handleInput("h");
      bar.handleInput("i");
      const [, , input] = renderPlain(bar);
      expect(input).toContain("hi");
    });

    it("handles backspace", () => {
      const bar = new StatusBar();
      bar.handleInput("a");
      bar.handleInput("b");
      bar.handleInput("c");
      bar.handleInput("\x7f");
      expect(bar.getInputValue()).toBe("ab");
    });

    it("handles enter to submit and clear", () => {
      const bar = new StatusBar();
      let submitted = "";
      bar.onSubmit = (msg) => {
        submitted = msg;
      };
      bar.handleInput("t");
      bar.handleInput("e");
      bar.handleInput("s");
      bar.handleInput("t");
      bar.handleInput("\r");
      expect(submitted).toBe("test");
      expect(bar.getInputValue()).toBe("");
    });

    it("does not submit empty input", () => {
      const bar = new StatusBar();
      let called = false;
      bar.onSubmit = () => {
        called = true;
      };
      bar.handleInput("\r");
      expect(called).toBe(false);
    });

    it("handles escape to clear", () => {
      const bar = new StatusBar();
      bar.handleInput("h");
      bar.handleInput("i");
      bar.handleInput("\x1b");
      expect(bar.getInputValue()).toBe("");
    });

    it("handles arrow keys", () => {
      const bar = new StatusBar();
      bar.handleInput("a");
      bar.handleInput("c");
      bar.handleInput("\x1b[D"); // left
      bar.handleInput("b");
      expect(bar.getInputValue()).toBe("abc");
    });

    it("handles delete key", () => {
      const bar = new StatusBar();
      bar.handleInput("a");
      bar.handleInput("b");
      bar.handleInput("\x1b[D"); // left
      bar.handleInput("\x1b[3~"); // delete
      expect(bar.getInputValue()).toBe("a");
    });
  });

  describe("hide", () => {
    it("returns empty lines when hidden", () => {
      const bar = new StatusBar();
      bar.hide();
      expect(bar.render(80)).toEqual([]);
    });
  });

  describe("cursor marker", () => {
    it("includes cursor marker on input line when focused", () => {
      const bar = new StatusBar();
      bar.focused = true;
      const lines = bar.render(80);
      expect(lines[2]).toContain(CURSOR_MARKER);
    });

    it("does not include cursor marker when not focused", () => {
      const bar = new StatusBar();
      bar.focused = false;
      const lines = bar.render(80);
      expect(lines[2]).not.toContain(CURSOR_MARKER);
    });
  });
});
