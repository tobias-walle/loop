import { afterEach, describe, expect, it } from "bun:test";
import { CURSOR_MARKER, setKittyProtocolActive } from "@mariozechner/pi-tui";
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
      bar.setStatus({
        step: 1,
        totalSteps: 2,
        costUsd: 0.05,
        durationMs: 10000,
        usage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      const plain = renderPlain(bar);
      expect(plain[0]).toBe(""); // blank spacer
      expect(plain[1]).toContain("─"); // top sep
      expect(plain[3]).toContain("─"); // bottom sep
      expect(plain[4]).toContain("10s");
      expect(plain[4]).toContain("$0.05");
      expect(plain[4]).toContain("150 tokens");
      expect(plain[4]).not.toContain("step 1/2");
    });
  });

  describe("footer rendering", () => {
    it("does not render step or iteration info", () => {
      const bar = new StatusBar();
      bar.setStatus({ step: 2, totalSteps: 3, iteration: 1, max: 3 });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).not.toContain("step 2/3");
      expect(footer).not.toContain("iter 1/3");
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

    it("renders token usage", () => {
      const bar = new StatusBar();
      bar.setStatus({
        usage: { inputTokens: 1500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      const [, , , , footer] = renderPlain(bar);
      expect(footer).toContain("2.0k tokens");
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

    it("handles bracketed paste", () => {
      const bar = new StatusBar();
      bar.handleInput("\x1b[200~hello world\x1b[201~");
      expect(bar.getInputValue()).toBe("hello world");
    });

    it("inserts pasted text at cursor position", () => {
      const bar = new StatusBar();
      bar.handleInput("ac");
      bar.handleInput("\x1b[D"); // left
      bar.handleInput("\x1b[200~b\x1b[201~");
      expect(bar.getInputValue()).toBe("abc");
    });
  });

  describe("input history", () => {
    it("navigates to previous input with arrow up", () => {
      const bar = new StatusBar();
      bar.onSubmit = () => {};
      bar.handleInput("first");
      bar.handleInput("\r");
      bar.handleInput("second");
      bar.handleInput("\r");
      bar.handleInput("\x1b[A"); // up
      expect(bar.getInputValue()).toBe("second");
      bar.handleInput("\x1b[A"); // up
      expect(bar.getInputValue()).toBe("first");
    });

    it("navigates forward with arrow down", () => {
      const bar = new StatusBar();
      bar.onSubmit = () => {};
      bar.handleInput("first");
      bar.handleInput("\r");
      bar.handleInput("second");
      bar.handleInput("\r");
      bar.handleInput("\x1b[A"); // up
      bar.handleInput("\x1b[A"); // up
      bar.handleInput("\x1b[B"); // down
      expect(bar.getInputValue()).toBe("second");
    });

    it("restores current input when navigating past end of history", () => {
      const bar = new StatusBar();
      bar.onSubmit = () => {};
      bar.handleInput("old");
      bar.handleInput("\r");
      bar.handleInput("current");
      bar.handleInput("\x1b[A"); // up - shows "old"
      expect(bar.getInputValue()).toBe("old");
      bar.handleInput("\x1b[B"); // down - restores "current"
      expect(bar.getInputValue()).toBe("current");
    });

    it("does nothing on arrow up with no history", () => {
      const bar = new StatusBar();
      bar.handleInput("text");
      bar.handleInput("\x1b[A"); // up
      expect(bar.getInputValue()).toBe("text");
    });
  });

  describe("ctrl+c behavior", () => {
    it("clears input when non-empty", () => {
      const bar = new StatusBar();
      let interrupted = false;
      bar.onInterrupt = () => {
        interrupted = true;
      };
      bar.handleInput("text");
      bar.handleInput("\x03"); // ctrl+c
      expect(bar.getInputValue()).toBe("");
      expect(interrupted).toBe(false);
    });

    it("triggers interrupt when input is empty", () => {
      const bar = new StatusBar();
      let interrupted = false;
      bar.onInterrupt = () => {
        interrupted = true;
      };
      bar.handleInput("\x03"); // ctrl+c
      expect(interrupted).toBe(true);
    });
  });

  describe("multiline input", () => {
    it("alt+enter inserts a newline (legacy terminals)", () => {
      const bar = new StatusBar();
      bar.handleInput("line1");
      bar.handleInput("\x1b\r"); // alt+enter in legacy mode
      bar.handleInput("line2");
      expect(bar.getInputValue()).toBe("line1\nline2");
    });

    it("ctrl+j inserts a newline", () => {
      const bar = new StatusBar();
      bar.handleInput("line1");
      bar.handleInput("\n"); // ctrl+j = 0x0A
      bar.handleInput("line2");
      expect(bar.getInputValue()).toBe("line1\nline2");
    });

    it("shift+enter inserts a newline (kitty protocol)", () => {
      setKittyProtocolActive(true);
      const bar = new StatusBar();
      bar.handleInput("line1");
      bar.handleInput("\x1b\r"); // shift+enter in kitty mode
      bar.handleInput("line2");
      expect(bar.getInputValue()).toBe("line1\nline2");
      setKittyProtocolActive(false);
    });

    it("ctrl+j inserts a newline (kitty protocol)", () => {
      setKittyProtocolActive(true);
      const bar = new StatusBar();
      bar.handleInput("line1");
      bar.handleInput("\x1b[106;5u"); // ctrl+j in CSI-u
      bar.handleInput("line2");
      expect(bar.getInputValue()).toBe("line1\nline2");
      setKittyProtocolActive(false);
    });

    it("renders multiple lines when input contains newlines", () => {
      const bar = new StatusBar();
      bar.focused = true;
      bar.handleInput("line1");
      bar.handleInput("\x1b\r");
      bar.handleInput("line2");
      const lines = bar.render(80);
      // blank, sep, line1, line2, sep, footer = 6 lines
      expect(lines.length).toBe(6);
    });

    it("wraps long text to terminal width", () => {
      const bar = new StatusBar();
      bar.focused = true;
      const longText = "a".repeat(25);
      bar.handleInput(longText);
      const lines = bar.render(20);
      // 25 chars at width 20 = 2 visual lines
      // blank, sep, line1, line2, sep, footer = 6 lines
      expect(lines.length).toBe(6);
    });

    it("submits multiline text correctly", () => {
      const bar = new StatusBar();
      let submitted = "";
      bar.onSubmit = (msg) => {
        submitted = msg;
      };
      bar.handleInput("line1");
      bar.handleInput("\x1b\r");
      bar.handleInput("line2");
      bar.handleInput("\r"); // submit
      expect(submitted).toBe("line1\nline2");
    });

    it("preserves newlines in pasted text", () => {
      const bar = new StatusBar();
      bar.handleInput("\x1b[200~hello\nworld\x1b[201~");
      expect(bar.getInputValue()).toBe("hello\nworld");
    });
  });

  describe("kitty protocol support", () => {
    afterEach(() => {
      setKittyProtocolActive(false);
    });

    it("handles kitty CSI-u enter", () => {
      setKittyProtocolActive(true);
      const bar = new StatusBar();
      let submitted = "";
      bar.onSubmit = (msg) => {
        submitted = msg;
      };
      bar.handleInput("\x1b[97u"); // 'a' in CSI-u
      bar.handleInput("\x1b[98u"); // 'b'
      bar.handleInput("\x1b[13u"); // enter (codepoint 13)
      expect(submitted).toBe("ab");
    });

    it("handles kitty arrow keys for history", () => {
      setKittyProtocolActive(true);
      const bar = new StatusBar();
      bar.onSubmit = () => {};
      bar.handleInput("first");
      bar.handleInput("\r");
      bar.handleInput("\x1b[1;1A"); // up in kitty
      expect(bar.getInputValue()).toBe("first");
    });

    it("handles kitty ctrl+c", () => {
      setKittyProtocolActive(true);
      const bar = new StatusBar();
      let interrupted = false;
      bar.onInterrupt = () => {
        interrupted = true;
      };
      bar.handleInput("text");
      bar.handleInput("\x1b[99;5u"); // ctrl+c in CSI-u (99='c', mod 5=ctrl)
      expect(bar.getInputValue()).toBe("");
      expect(interrupted).toBe(false);
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
