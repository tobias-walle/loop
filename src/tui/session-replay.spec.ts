import { expect, test } from "bun:test";
import type { StoredInvocation } from "../lib/session-events.js";
import { createEvent } from "../lib/session-events.js";
import { createRunView } from "./run-view.js";
import { replaySession } from "./session-replay.js";

const invocation: StoredInvocation = {
  sessionId: "20260713T082739.279Z-dbcecf742",
  loopVersion: "0.1.0",
  projectRoot: "/project",
  steps: [{ type: "task", task: "add a paragraph to poem.txt", until: "two paragraphs" }],
  template: { source: "default", content: "template", sha256: "hash" },
  agent: { name: "pi", model: "gpt-5.6-sol", args: {}, passthroughArgs: [] },
};

function plain(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

test("replays persisted history through the normal run renderer", () => {
  const view = createRunView(() => {});
  replaySession(
    view,
    [
      createEvent("session_created", invocation),
      createEvent("step_started", { stepIndex: 0, step: invocation.steps[0] }),
      createEvent("agent_event", {
        stepIndex: 0,
        executionId: "execution-1",
        event: {
          type: "text_delta",
          text: "I'll inspect `poem.txt`.",
          parentToolUseId: null,
        },
      }),
      createEvent("agent_event", {
        stepIndex: 0,
        executionId: "execution-1",
        event: {
          type: "tool_start",
          toolId: "tool-1",
          tool: "Read",
          input: { file_path: "poem.txt" },
          parentToolUseId: null,
        },
      }),
      createEvent("agent_usage_updated", {
        executionId: "execution-1",
        costUsd: 0.02,
        durationMs: 1200,
        usage: { inputTokens: 100, outputTokens: 20 },
      }),
      createEvent("agent_session_completed", {
        stepIndex: 0,
        executionId: "execution-1",
        exitReason: "done",
      }),
    ],
    invocation,
  );

  const output = plain(view.content.render(100).join("\n"));
  expect(output).toContain("session 20260713T082739.279Z-dbcecf742");
  expect(output).toContain("[step 01/01 · iter 01 · pi · gpt-5.6-sol]");
  expect(output).toContain("add a paragraph to poem.txt");
  expect(output).toContain("› I'll inspect `poem.txt`.");
  expect(output).toContain("◇ read");
  expect(output).toContain("poem.txt");
  expect(output).toContain("✓ done");
  expect(output).toContain("$0.02");
});

test("replays the persisted loop completion iteration", () => {
  const view = createRunView(() => {});
  replaySession(
    view,
    [
      createEvent("agent_usage_updated", {
        executionId: "execution-1",
        costUsd: 0,
        durationMs: 100,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
      createEvent("agent_session_completed", {
        stepIndex: 0,
        executionId: "execution-1",
        exitReason: "loop_done",
        iteration: 3,
      }),
    ],
    invocation,
  );

  expect(plain(view.content.render(100).join("\n"))).toContain("3 iterations");
});

test("does not leave a live waiting indicator in interrupted history", () => {
  const view = createRunView(() => {});
  replaySession(
    view,
    [
      createEvent("step_started", { stepIndex: 0, step: invocation.steps[0] }),
      createEvent("attempt_aborted", {}),
    ],
    invocation,
  );

  const output = plain(view.content.render(100).join("\n"));
  expect(output).not.toContain("waiting");
  expect(output).toContain("▲ interrupted");
});

test("live events append to replayed history", () => {
  const view = createRunView(() => {});
  replaySession(view, [createEvent("session_created", invocation)], invocation);

  view.router.showStepHeader(1, 1, "continue the work", 2, 3, undefined, "pi", {});

  expect(view.hasContent()).toBe(true);
  const output = plain(view.content.render(100).join("\n"));
  expect(output.indexOf("session 20260713T082739.279Z-dbcecf742")).toBeLessThan(
    output.indexOf("continue the work"),
  );
  view.reset();
  expect(view.hasContent()).toBe(false);
});
