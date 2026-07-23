import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../agents/types.js";
import type { SessionEvent, SessionEventType } from "../lib/session-event.js";
import { type RunOutput, createConsoleRunReporter } from "./console-run-reporter.js";

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

function recording(isTTY = false): RunOutput & { text: string } {
  return {
    isTTY,
    text: "",
    write(text) {
      this.text += text;
    },
  };
}

describe("console run reporter", () => {
  test("non-TTY output is plain and ignores text deltas", () => {
    const output = recording();
    using reporter = createConsoleRunReporter(output);
    reporter.report(
      event("step", "step_started", { stepIndex: 0, step: { type: "task", task: "Work" } }),
    );
    reporter.report(event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }));
    reporter.report(agent("delta", { type: "text_delta", text: "partial", parentToolUseId: null }));
    reporter.report(
      agent("done", { type: "text_done", text: "complete\nanswer", parentToolUseId: null }),
    );

    expect(output.text).toContain("Work");
    expect(output.text).toContain("complete\nanswer\n");
    expect(output.text).not.toContain("partial");
    expect(output.text).not.toContain("\x1b");
  });

  test("TTY output uses SGR without terminal mutation controls", () => {
    const output = recording(true);
    using reporter = createConsoleRunReporter(output);
    reporter.report(event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }));
    reporter.report(agent("error", { type: "error", message: "broken" }));

    expect(output.text).toContain("\x1b[");
    expect(output.text).not.toMatch(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: verifies terminal control safety
      /\x1b\[(?:\?1049[hl]|3J|[0-9;]*[ABCDEFGHJKSTfsu]|\?25[hl]|\?2004[hl]|\?2026[hl])/,
    );
  });

  test("deduplicates event IDs and tool IDs", () => {
    const output = recording();
    using reporter = createConsoleRunReporter(output);
    const text = agent("text", { type: "text_done", text: "once", parentToolUseId: null });
    const tool = agent("tool", {
      type: "tool_start",
      toolId: "tool-1",
      tool: "Read",
      input: { path: "file.ts" },
      parentToolUseId: null,
    });
    reporter.report(text);
    reporter.report(text);
    reporter.report(tool);
    reporter.report(agent("tool-copy", { ...tool.data.event, type: "tool_start" } as AgentEvent));

    expect(output.text.match(/once/g)).toHaveLength(1);
    expect(output.text.match(/file\.ts/g)).toHaveLength(1);
  });

  test("renders nested task completion and run lifecycle records once", () => {
    const output = recording();
    using reporter = createConsoleRunReporter(output);
    reporter.report(
      agent("task", {
        type: "task_done",
        taskId: "task-1",
        toolUseId: "tool-1",
        status: "completed",
        summary: "subagent fixed tests",
        durationMs: 1200,
      }),
    );
    reporter.report(
      agent("retry", { type: "retry", attempt: 2, maxRetries: 3, delayMs: 10, error: "busy" }),
    );
    reporter.report(event("aborted", "attempt_aborted", {}));
    reporter.report(event("aborted-copy", "attempt_aborted", {}));
    reporter.report(event("run", "run_completed", {}));

    expect(output.text).toContain("subagent fixed tests");
    expect(output.text).toContain("retry");
    expect(output.text.match(/interrupted/g)).toHaveLength(1);
    expect(output.text).toContain("loop");
  });

  test("disposal is idempotent and suppresses later events", () => {
    const output = recording();
    const reporter = createConsoleRunReporter(output);
    reporter[Symbol.dispose]();
    reporter[Symbol.dispose]();
    reporter.report(agent("late", { type: "text_done", text: "late", parentToolUseId: null }));
    expect(output.text).toBe("");
  });

  test("contains sink failures and disables further output", () => {
    let writes = 0;
    const reporter = createConsoleRunReporter({
      isTTY: false,
      write() {
        writes++;
        throw new Error("closed pipe");
      },
    });
    expect(() => reporter.report(event("one", "attempt_aborted", {}))).not.toThrow();
    expect(() => reporter.report(event("two", "run_completed", {}))).not.toThrow();
    expect(writes).toBe(1);
  });

  test("bounds tool previews but preserves long assistant text", () => {
    const output = recording();
    using reporter = createConsoleRunReporter(output);
    const long = "x".repeat(2_000);
    reporter.report(
      agent("tool", {
        type: "tool_start",
        toolId: "long-tool",
        tool: "Bash",
        input: { command: long },
        parentToolUseId: null,
      }),
    );
    reporter.report(agent("text", { type: "text_done", text: long, parentToolUseId: null }));

    const lines = output.text.split("\n");
    expect(lines[0].length).toBeLessThan(600);
    expect(output.text).toContain(long);
  });
});
