import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "../../lib/session-event.js";
import { renderTimeline } from "./timeline.js";

function event(
  id: string,
  type: SessionEvent["type"],
  data: Record<string, unknown>,
): SessionEvent {
  return { version: 1, id, timestamp: "2026-01-01T00:00:00Z", type, data };
}

function plain(text: string): string {
  return text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: test strips terminal CSI controls
    /\x1b\[[0-?]*[ -/]*[@-~]/g,
    "",
  );
}

function invocation() {
  return {
    sessionId: "session",
    loopVersion: "test",
    projectRoot: "/project",
    steps: [{ type: "task", task: "A long task title" }],
    template: { source: "default", content: "{{task}}", sha256: "hash" },
    agent: { name: "pi", args: {}, passthroughArgs: [] },
  };
}

describe("browser timeline", () => {
  test("renders stored events through the live presentation path", () => {
    const blocks = renderTimeline(
      {
        warnings: [],
        events: [
          event("created", "session_created", invocation()),
          event("step", "step_started", {
            stepIndex: 0,
            step: { type: "task", task: "A long task title" },
          }),
          event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }),
          event("session", "agent_event", {
            stepIndex: 0,
            executionId: "exec",
            event: { type: "session_start", model: "test-model", sessionId: "agent", tools: [] },
          }),
          event("delta", "agent_event", {
            stepIndex: 0,
            executionId: "exec",
            event: { type: "text_delta", text: "assistant output", parentToolUseId: null },
          }),
          event("text", "agent_event", {
            stepIndex: 0,
            executionId: "exec",
            event: { type: "text_done", text: "assistant output", parentToolUseId: null },
          }),
          event("abort", "attempt_aborted", {}),
        ],
      },
      80,
    );
    const rendered = blocks.flatMap((block) => block.lines).join("\n");
    const transcript = plain(rendered);

    expect(rendered).toContain("\x1b[");
    expect(transcript).toContain("[step 01/01 · pi · test-model]");
    expect(transcript).toContain("› assistant output");
    expect(transcript).toContain("▲ interrupted");
    expect(transcript).not.toContain("Step 1:");
  });

  test("replays authoritative completed text when deltas are absent", () => {
    const blocks = renderTimeline(
      {
        warnings: [],
        events: [
          event("created", "session_created", invocation()),
          event("step", "step_started", {
            stepIndex: 0,
            step: { type: "task", task: "A long task title" },
          }),
          event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }),
          event("text", "agent_event", {
            stepIndex: 0,
            executionId: "exec",
            event: { type: "text_done", text: "completed without deltas", parentToolUseId: null },
          }),
          event("abort", "attempt_aborted", {}),
        ],
      },
      80,
    );

    expect(plain(blocks.flatMap((block) => block.lines).join("\n"))).toContain(
      "› completed without deltas",
    );
  });

  test("supports nested agents and legacy lines", () => {
    const nested = renderTimeline(
      {
        warnings: [],
        events: [
          event("tool", "agent_event", {
            stepIndex: 0,
            executionId: "exec",
            event: {
              type: "tool_start",
              toolId: "x",
              tool: "Task",
              input: { description: "child" },
              parentToolUseId: "parent",
            },
          }),
        ],
      },
      80,
    );
    expect(nested[0].lines[0]).toContain("child");
    expect(renderTimeline({ warnings: [], lines: ["legacy output"] }, 80)[0].eventId).toBe(
      "legacy-0",
    );
  });

  test("renders the live waiting indicator for incomplete sessions", () => {
    const blocks = renderTimeline(
      {
        warnings: [],
        events: [
          event("created", "session_created", invocation()),
          event("step", "step_started", {
            stepIndex: 0,
            step: { type: "task", task: "A long task title" },
          }),
          event("iteration", "step_iteration_started", { stepIndex: 0, iteration: 1 }),
        ],
      },
      80,
    );
    expect(plain(blocks.at(-1)?.lines.join(" ") ?? "")).toContain("waiting");
  });
});
