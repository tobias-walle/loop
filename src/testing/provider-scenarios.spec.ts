import { describe, expect, test } from "bun:test";
import { createClaudeAdapter } from "../agents/claude/adapter";
import { createPiAdapter } from "../agents/pi/adapter";
import type { AgentAdapter, AgentEvent } from "../agents/types";
import { createClaudeScenario } from "./claude-scenario";
import { createFakeProcessSpawner } from "./fake-process";
import { createPiScenario } from "./pi-scenario";

async function run(adapter: AgentAdapter): Promise<AgentEvent[]> {
  const session = adapter.spawn("work");
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  await session.exited;
  return events;
}

describe("Pi scenarios", () => {
  test("serializes initialization, text, tools, retries, usage, and completion", async () => {
    const process = createFakeProcessSpawner();
    process.givenRun(
      createPiScenario()
        .session({ id: "pi-session", model: "pi-model", tools: ["read"] })
        .text("implemented")
        .tool({ id: "tool-1", name: "read", input: { path: "a.ts" }, result: "source" })
        .retry({ attempt: 1, maxRetries: 3, delayMs: 10, error: "rate" })
        .usage({ input: 10, output: 4, cacheCreation: 2, cacheRead: 3, costUsd: 0.2 })
        .complete({ result: "implemented", durationMs: 12 })
        .build(),
    );

    const events = await run(createPiAdapter({ spawnProcess: process.spawn }));

    expect(events).toContainEqual({
      type: "session_start",
      model: "pi-model",
      sessionId: "pi-session",
      tools: ["read"],
    });
    expect(events).toContainEqual({
      type: "text_delta",
      text: "implemented",
      parentToolUseId: null,
    });
    expect(events).toContainEqual({
      type: "tool_start",
      toolId: "tool-1",
      tool: "read",
      input: { path: "a.ts" },
      parentToolUseId: null,
    });
    expect(events).toContainEqual({
      type: "retry",
      attempt: 1,
      maxRetries: 3,
      delayMs: 10,
      error: "rate",
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      result: "implemented",
      costUsd: 0.2,
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationTokens: 2,
        cacheReadTokens: 3,
      },
    });
  });

  test("supports stderr, process failure, multiple runs, and invocation inspection", async () => {
    const process = createFakeProcessSpawner();
    process.givenRun(
      createPiScenario().complete({ result: "first" }).stderr("provider warning").exit(9).build(),
    );
    process.givenRun(createPiScenario().complete({ result: "second" }).build());
    const adapter = createPiAdapter({ command: "pi-test", spawnProcess: process.spawn });

    expect((await run(adapter)).at(-1)).toEqual({
      type: "error",
      message: "pi JSON process exited with code 9: provider warning",
    });
    expect((await run(adapter)).at(-1)).toMatchObject({ type: "done", result: "second" });
    expect(process.invocations().map((invocation) => invocation.command)).toEqual([
      "pi-test",
      "pi-test",
    ]);
  });
});

describe("Claude scenarios", () => {
  test("serializes initialization, streaming text, tools, subagents, retries, usage, and completion", async () => {
    const process = createFakeProcessSpawner();
    process.givenRun(
      createClaudeScenario()
        .session({ id: "claude-session", model: "claude-model", tools: ["Read", "Task"] })
        .text(["imple", "mented"])
        .tool({ id: "tool-1", name: "Read", input: { file_path: "a.ts" }, result: "source" })
        .subagent({
          taskId: "task-1",
          toolUseId: "agent-1",
          description: "Inspect code",
          prompt: "Read files",
          summary: "Inspected",
          model: "claude-haiku",
          durationMs: 15,
          totalTokens: 20,
        })
        .retry({ attempt: 2, maxRetries: 4, delayMs: 20, error: "rate" })
        .complete({
          result: "implemented",
          durationMs: 30,
          costUsd: 0.3,
          usage: { input: 11, output: 5, cacheCreation: 2, cacheRead: 4 },
        })
        .build(),
    );

    const events = await run(createClaudeAdapter({ spawnProcess: process.spawn }));

    expect(events).toContainEqual({
      type: "session_start",
      model: "claude-model",
      sessionId: "claude-session",
      tools: ["Read", "Task"],
    });
    expect(events).toContainEqual({
      type: "text_done",
      text: "implemented",
      parentToolUseId: null,
    });
    expect(events).toContainEqual({
      type: "tool_done",
      toolId: "tool-1",
      result: "source",
      parentToolUseId: null,
    });
    expect(events).toContainEqual({
      type: "task_done",
      taskId: "task-1",
      toolUseId: "agent-1",
      status: "completed",
      summary: "Inspected",
      durationMs: 15,
      model: "claude-haiku",
      totalTokens: 20,
    });
    expect(events.at(-1)).toMatchObject({ type: "done", result: "implemented", costUsd: 0.3 });
  });

  test("supports provider failure output", async () => {
    const process = createFakeProcessSpawner();
    process.givenRun(createClaudeScenario().fail("authentication failed").build());

    expect(await run(createClaudeAdapter({ spawnProcess: process.spawn }))).toEqual([
      { type: "error", message: "authentication failed" },
    ]);
  });
});

describe("raw provider escape hatches", () => {
  test("preserves malformed Pi bytes and explicit chunk boundaries", async () => {
    const process = createFakeProcessSpawner();
    const scenario = createPiScenario()
      .rawChunks(['{"type":"agent_', 'start"}\n'])
      .raw("not-json\n")
      .build();
    process.givenRun(scenario);

    const events = await run(createPiAdapter({ spawnProcess: process.spawn }));

    expect(scenario.stdoutChunks).toEqual(['{"type":"agent_', 'start"}\n', "not-json\n"]);
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(events.at(-1)?.type === "error" ? events.at(-1)?.message : "").toContain("JSON");
  });

  test("anchors Claude semantic records to parser-supported protocol shapes", () => {
    const scenario = createClaudeScenario()
      .session({ id: "session", model: "claude", tools: ["Read"] })
      .text(["hello"])
      .complete({ result: "hello" })
      .build();
    const lines = scenario.stdoutChunks?.map((chunk) => JSON.parse(String(chunk))) ?? [];

    expect(lines[0]).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: "session",
      model: "claude",
    });
    expect(lines.at(-1)).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "hello",
    });
  });
});
