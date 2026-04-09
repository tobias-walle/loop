import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

const SESSION = "loop-input-test";
const HARNESS = "src/testing/tui-harness.ts";
const WAIT_MS = 15_000;

function tmux(...args: string[]): string {
  return execSync(`tmux ${args.join(" ")}`, { encoding: "utf-8", timeout: 5000 }).trim();
}

function sendKeys(keys: string): void {
  tmux("send-keys", "-t", SESSION, keys);
}

function sendLiteral(text: string): void {
  execSync(`tmux send-keys -t ${SESSION} -l -- ${JSON.stringify(text)}`, { timeout: 5000 });
}

function capture(): string {
  return tmux("capture-pane", "-t", SESSION, "-p").replaceAll("▏", "");
}

/** Extract the input line (between the two ─── separators at the bottom). */
function getInputLine(): string {
  const lines = capture().split("\n");
  // Find the two separator lines near the bottom, input is between them
  for (let i = lines.length - 1; i >= 2; i--) {
    if (lines[i].startsWith("─") && lines[i - 2].startsWith("─")) {
      return lines[i - 1].trim();
    }
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the input line contains the expected text.
 * Provides a clear error showing the actual input content on failure.
 */
async function expectInput(expected: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  let lastInput = "";
  while (Date.now() - start < timeoutMs) {
    lastInput = getInputLine();
    if (lastInput.includes(expected)) return;
    await sleep(150);
  }
  throw new Error(
    `Input line does not contain "${expected}" after ${timeoutMs}ms.\n` +
      `  Input line: "${lastInput}"\n` +
      `  Full screen:\n${capture()}`,
  );
}

/** Wait until the input line does NOT contain the given text. */
async function expectInputWithout(unexpected: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  let lastInput = "";
  while (Date.now() - start < timeoutMs) {
    lastInput = getInputLine();
    if (!lastInput.includes(unexpected)) return;
    await sleep(150);
  }
  throw new Error(
    `Input line still contains "${unexpected}" after ${timeoutMs}ms.\n` +
      `  Input line: "${lastInput}"\n` +
      `  Full screen:\n${capture()}`,
  );
}

async function waitForContent(pattern: string | RegExp, timeoutMs = 3000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const content = capture();
    if (typeof pattern === "string" ? content.includes(pattern) : pattern.test(content)) {
      return content;
    }
    await sleep(200);
  }
  const finalContent = capture();
  throw new Error(
    `Timed out waiting for "${pattern}" after ${timeoutMs}ms.\n` +
      `  Full screen:\n${finalContent}`,
  );
}

describe("InputLine integration (tmux)", () => {
  beforeEach(() => {
    try {
      tmux("kill-session", "-t", SESSION);
    } catch {
      // ignore — no prior session
    }
    tmux("new-session", "-d", "-s", SESSION, "-x", "80", "-y", "24", `bun ${HARNESS} ${WAIT_MS}`);
  });

  afterEach(() => {
    try {
      tmux("kill-session", "-t", SESSION);
    } catch {
      // ignore
    }
  });

  it("renders the TUI with input area and status bar", async () => {
    const content = await waitForContent("step 1/1");
    expect(content).toContain("Test task");
    expect(content).toContain("─");
  });

  it("accepts typed characters and shows them in the input line", async () => {
    await waitForContent("step 1/1");
    sendLiteral("hello");
    await expectInput("hello");
  });

  it("clears input with Escape", async () => {
    await waitForContent("step 1/1");
    sendLiteral("some text");
    await expectInput("some text");
    sendKeys("Escape");
    await expectInputWithout("some text");
  });

  it("navigates history with arrow up/down", async () => {
    await waitForContent("step 1/1");

    sendLiteral("first message");
    sendKeys("Enter");
    await sleep(400);

    sendLiteral("second message");
    sendKeys("Enter");
    await sleep(400);

    // Arrow up should recall "second message"
    sendKeys("Up");
    await expectInput("second message");

    // Arrow up again should recall "first message"
    sendKeys("Up");
    await expectInput("first message");

    // Arrow down should go back to "second message"
    sendKeys("Down");
    await expectInput("second message");
  });

  it("ctrl+c clears input when non-empty", async () => {
    await waitForContent("step 1/1");

    sendLiteral("text to clear");
    await expectInput("text to clear");

    sendKeys("C-c");
    await expectInputWithout("text to clear");
  });

  it("ctrl+c on empty input interrupts the process", async () => {
    await waitForContent("step 1/1");

    sendKeys("C-c");
    await sleep(500);

    // The process should have exited — the pane either shows exit status or is gone
    let alive = true;
    try {
      const content = capture();
      // If the harness exited, tmux shows blank or shell prompt — no more "step 1/1"
      alive = content.includes("step 1/1");
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });

  it("supports pasting text", async () => {
    await waitForContent("step 1/1");

    sendLiteral("pasted content");
    await expectInput("pasted content");
  });

  it("moves cursor with arrow keys and inserts mid-text", async () => {
    await waitForContent("step 1/1");

    sendLiteral("ac");
    await expectInput("ac");

    sendKeys("Left");
    await sleep(100);
    sendLiteral("b");
    await expectInput("abc");
  });

  it("handles Home and End keys", async () => {
    await waitForContent("step 1/1");

    sendLiteral("world");
    await expectInput("world");

    sendKeys("Home");
    await sleep(100);
    sendLiteral("hello ");
    await expectInput("hello world");
  });

  it("handles backspace and delete", async () => {
    await waitForContent("step 1/1");

    sendLiteral("abcd");
    await expectInput("abcd");

    sendKeys("BSpace"); // deletes 'd'
    await expectInput("abc");

    sendKeys("Home");
    await sleep(100);
    sendKeys("DC"); // forward-deletes 'a'
    await expectInput("bc");
  });
});
