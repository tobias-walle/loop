import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../agents/types.js";
import { CLEAR_SCREEN, ENTER_ALT_SCREEN, ERASE_SCROLLBACK, LEAVE_ALT_SCREEN } from "../lib/ansi.js";
import type { SessionEvent, SessionEventType } from "../lib/session-event.js";
import { createLiveRunReporter } from "./live-run-reporter.js";

function event<T extends Record<string, unknown>>(
  id: string,
  type: SessionEventType,
  data: T,
): SessionEvent<T> {
  return { version: 1, id, timestamp: "2026-01-01T00:00:00.000Z", type, data };
}

function agent(id: string, value: AgentEvent): SessionEvent {
  return event(id, "agent_event", { stepIndex: 0, executionId: "exec", event: value });
}

class ManualAnimation {
  private callback: (() => void) | undefined;

  setInterval(callback: () => void): string {
    this.callback = callback;
    return "animation";
  }

  clearInterval(): void {
    this.callback = undefined;
  }

  tick(): void {
    this.callback?.();
  }
}

class RecordingOutput {
  isTTY = true;
  columns = 100;
  rows = 30;
  text = "";
  readonly listeners = new Set<() => void>();

  write(text: string): void {
    this.text += text;
  }

  on(_event: "resize", listener: () => void): void {
    this.listeners.add(listener);
  }

  off(_event: "resize", listener: () => void): void {
    this.listeners.delete(listener);
  }
}

function sessionCreated(): SessionEvent {
  return event("created", "session_created", {
    sessionId: "session",
    loopVersion: "test",
    projectRoot: "/project",
    steps: [{ type: "task", task: "Work" }],
    template: { source: "default", content: "{{task}}", sha256: "hash" },
    agent: { name: "pi", model: undefined, args: {}, passthroughArgs: [] },
  });
}

async function rendered(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 250;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("TUI did not render within 250ms");
    await Bun.sleep(1);
  }
}

function plain(text: string): string {
  return text
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: test strips terminal OSC controls
      /\x1b\][^\x07]*\x07/g,
      "",
    )
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: test strips terminal CSI controls
      /\x1b\[[0-?]*[ -/]*[@-~]/g,
      "",
    );
}

describe("live run reporter", () => {
  test("preserves the original header and renders text deltas before completion", async () => {
    const output = new RecordingOutput();
    using reporter = createLiveRunReporter(output);
    reporter.report(sessionCreated());
    reporter.report(
      event("step", "step_started", { stepIndex: 0, step: { type: "task", task: "Work" } }),
    );
    reporter.report(event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }));
    reporter.report(
      agent("delta", { type: "text_delta", text: "streamed now", parentToolUseId: null }),
    );
    await rendered(() => output.text.includes("streamed now"));

    expect(output.text).toContain("[step 01/01 · pi]");
    expect(output.text).toContain("Work");
    expect(output.text).toContain("streamed now");
    expect(output.text).not.toContain(ENTER_ALT_SCREEN);
    expect(output.text).not.toContain(LEAVE_ALT_SCREEN);
    expect(output.text).not.toContain(ERASE_SCROLLBACK);
  });

  test("renders the original spinner, completion, and run summary", async () => {
    const output = new RecordingOutput();
    using reporter = createLiveRunReporter(output);
    reporter.report(sessionCreated());
    reporter.report(
      event("step", "step_started", {
        stepIndex: 0,
        step: { type: "task", task: "Work", until: "done", max: 3 },
      }),
    );
    reporter.report(
      event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1, max: 3 }),
    );
    await rendered(() => output.text.includes("waiting"));
    expect(output.text).toContain("[step 01/01 · iter 01/03 · pi]");
    expect(output.text).toContain("waiting");

    reporter.report(
      event("usage", "agent_usage_updated", {
        executionId: "exec",
        costUsd: 0.25,
        durationMs: 1_500,
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      }),
    );
    reporter.report(
      event("complete", "agent_session_completed", {
        stepIndex: 0,
        executionId: "exec",
        exitReason: "loop_done",
        iteration: 1,
      }),
    );
    reporter.report(event("run", "run_completed", {}));
    await rendered(() => plain(output.text).includes("✓ loop"));

    const renderedText = plain(output.text);
    expect(renderedText).toContain("✓ done");
    expect(renderedText).toContain("✓ loop");
    expect(renderedText).toContain("$0.25");
    expect(renderedText).toContain("1.2k tokens");
  });

  test("does not clear the screen when an active agent scrolls above the viewport", async () => {
    const output = new RecordingOutput();
    output.rows = 5;
    const animation = new ManualAnimation();
    const reporter = createLiveRunReporter(output, { animation });
    reporter.report(sessionCreated());
    reporter.report(
      event("step", "step_started", { stepIndex: 0, step: { type: "task", task: "Work" } }),
    );
    reporter.report(event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }));
    reporter.report(
      agent("agent-start", {
        type: "tool_start",
        toolId: "agent-1",
        tool: "Agent",
        input: { description: "Audit changes", model: "profile/medium" },
        parentToolUseId: null,
      }),
    );
    await rendered(() => plain(output.text).includes("Audit changes"));

    for (let index = 0; index < 8; index++) {
      reporter.report(
        agent(`tool-${index}`, {
          type: "tool_start",
          toolId: `tool-${index}`,
          tool: "Read",
          input: { file_path: `src/file-${index}.ts` },
          parentToolUseId: null,
        }),
      );
    }
    await rendered(() => plain(output.text).includes("src/file-7.ts"));

    output.text = "";
    await Bun.sleep(125);
    animation.tick();
    await Bun.sleep(25);

    expect(output.text).not.toContain(CLEAR_SCREEN);
    reporter[Symbol.dispose]();
  });

  test("does not double-count authoritative usage in the live status", async () => {
    const output = new RecordingOutput();
    using reporter = createLiveRunReporter(output);
    reporter.report(sessionCreated());
    reporter.report(
      event("usage", "agent_usage_updated", {
        executionId: "exec",
        costUsd: 0.25,
        durationMs: 1_500,
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      }),
    );
    await rendered(() => plain(output.text).includes("$0.25"));

    expect(plain(output.text)).toContain("$0.25");
    expect(plain(output.text)).not.toContain("$0.50");
  });

  test("flushes the final summary before awaited disposal without clearing the screen", async () => {
    const output = new RecordingOutput();
    const reporter = createLiveRunReporter(output);
    reporter.report(sessionCreated());
    reporter.report(event("run", "run_completed", {}));

    await reporter[Symbol.asyncDispose]();

    expect(plain(output.text)).toContain("✓ loop");
    expect(output.text).not.toContain(CLEAR_SCREEN);
    expect(output.listeners.size).toBe(0);
  });

  test("contains output failures without replacing the run", () => {
    let writes = 0;
    let reporter: ReturnType<typeof createLiveRunReporter> | undefined;

    expect(() => {
      reporter = createLiveRunReporter({
        isTTY: true,
        write() {
          writes++;
          throw new Error("closed pipe");
        },
      });
      reporter.report(sessionCreated());
      reporter[Symbol.dispose]();
    }).not.toThrow();
    expect(writes).toBeGreaterThan(0);
  });

  test("owns and clears its animation clock", () => {
    const output = new RecordingOutput();
    const cleared: unknown[] = [];
    const reporter = createLiveRunReporter(output, {
      animation: {
        setInterval(_callback, delayMs) {
          expect(delayMs).toBe(120);
          return "animation";
        },
        clearInterval(handle) {
          cleared.push(handle);
        },
      },
    });

    reporter[Symbol.dispose]();
    reporter[Symbol.dispose]();

    expect(cleared).toEqual(["animation"]);
    expect(output.listeners.size).toBe(0);
  });
});
