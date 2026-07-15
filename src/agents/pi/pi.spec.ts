import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { createPiAdapter } from "./adapter";
import { completePendingDone, createPiEventState, mapPiEvent } from "./events";
import { readJsonLines } from "./json";

describe("pi JSONL", () => {
  test("manual reader handles LF and CRLF", async () => {
    const stream = new PassThrough();
    const seen: unknown[] = [];
    const reader = (async () => {
      for await (const item of readJsonLines(stream)) seen.push(item);
    })();
    stream.write('{"a":1}\n{"b":2}\r\n');
    stream.end();
    await reader;
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("pi adapter", () => {
  test("spawns one-shot JSON mode with the prompt as an argument", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const argvPath = path.join(dir, "argv.json");
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "session", id: "sess-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "assistant", model: "gpt-5.5" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: "hello", durationMs: 12, messages: [{ role: "assistant", usage: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4, cost: { total: 0.5 } } }] }) + "\\n");
process.exit(0);
`,
    );

    const session = createPiAdapter({ command: process.execPath, rawArgs: [scriptPath] }).spawn(
      "hello",
    );
    const events = [];
    for await (const event of session.events) events.push(event);
    await session.exited;

    expect(JSON.parse(fs.readFileSync(argvPath, "utf-8"))).toEqual([
      "--no-session",
      "--print",
      "--mode",
      "json",
      "hello",
    ]);
    expect(events).toEqual([
      { type: "session_start", model: "pi", sessionId: "sess-1", tools: [] },
      { type: "session_start", model: "gpt-5.5", sessionId: "sess-1", tools: [] },
      { type: "text_delta", text: "hello", parentToolUseId: null },
      {
        type: "done",
        result: "hello",
        costUsd: 0.5,
        durationMs: 12,
        usage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
      },
    ]);
  });

  test("uses wall time when one-shot events omit duration", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `await new Promise((resolve) => setTimeout(resolve, 20));
process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: "done", usage: { input: 1, output: 1 } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
`,
    );

    const session = createPiAdapter({ command: process.execPath, rawArgs: [scriptPath] }).spawn(
      "hello",
    );
    const events = [];
    for await (const event of session.events) events.push(event);
    await session.exited;

    const done = events.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.durationMs).toBeGreaterThanOrEqual(10);
  });

  test("reports stderr when the process fails after a completion event", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: "done", usage: { input: 1, output: 1 } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
process.stderr.write("provider unavailable\\n");
process.exitCode = 9;
`,
    );

    const session = createPiAdapter({ command: process.execPath, rawArgs: [scriptPath] }).spawn(
      "hello",
    );
    const events = [];
    for await (const event of session.events) events.push(event);
    await session.exited;

    expect(events.at(-1)).toEqual({
      type: "error",
      message: "pi JSON process exited with code 9: provider unavailable",
    });
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  test("rejects --mode in args", () => {
    expect(() => createPiAdapter({ args: { mode: "text" } })).toThrow("does not allow");
    expect(() => createPiAdapter({ rawArgs: ["--mode", "text"] })).toThrow("does not allow");
  });

  test("does not duplicate --no-session from configured args", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const argvPath = path.join(dir, "argv.json");
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
`,
    );

    const session = createPiAdapter({
      command: process.execPath,
      rawArgs: [scriptPath, "--no-session"],
    }).spawn("hello");
    await session.exited;

    expect(JSON.parse(fs.readFileSync(argvPath, "utf-8"))).toEqual([
      "--no-session",
      "--print",
      "--mode",
      "json",
      "hello",
    ]);
  });
});

describe("pi event mapping", () => {
  test("stores session metadata and maps agent_start to session_start", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        {
          type: "session",
          id: "019f194f-e403-7433-b91e-79fc33adb1dc",
          version: 3,
          cwd: "/project",
        },
        state,
      ),
    ).toEqual([]);
    expect(mapPiEvent({ type: "agent_start" }, state)).toEqual([
      {
        type: "session_start",
        model: "pi",
        sessionId: "019f194f-e403-7433-b91e-79fc33adb1dc",
        tools: [],
      },
    ]);
    expect(state.cwd).toBe("/project");
    expect(state.sessionVersion).toBe(3);
  });

  test("updates session model from assistant message_start", () => {
    const state = createPiEventState();
    mapPiEvent({ type: "session", id: "sess-1" }, state);
    expect(mapPiEvent({ type: "agent_start" }, state)).toEqual([
      { type: "session_start", model: "pi", sessionId: "sess-1", tools: [] },
    ]);
    expect(mapPiEvent({ type: "message_start", message: { model: "gpt-5.5" } }, state)).toEqual([
      { type: "session_start", model: "gpt-5.5", sessionId: "sess-1", tools: [] },
    ]);
    expect(mapPiEvent({ type: "message_start", message: { model: "gpt-5.5" } }, state)).toEqual([]);
  });

  test("maps text deltas and text end", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hel" } },
        state,
      ),
    ).toEqual([{ type: "text_delta", text: "hel", parentToolUseId: null }]);
    expect(
      mapPiEvent(
        { type: "message_update", assistantMessageEvent: { type: "text_end", content: "hello" } },
        state,
      ),
    ).toEqual([{ type: "text_done", text: "hello", parentToolUseId: null }]);
  });

  test("maps tool start and end", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a" } },
        state,
      ),
    ).toEqual([
      {
        type: "tool_start",
        toolId: "t1",
        tool: "read",
        input: { path: "a" },
        parentToolUseId: null,
      },
    ]);
    expect(
      mapPiEvent(
        {
          type: "tool_execution_end",
          toolCallId: "t1",
          result: { content: [{ type: "text", text: "ok" }] },
        },
        state,
      ),
    ).toEqual([{ type: "tool_done", toolId: "t1", result: "ok", parentToolUseId: null }]);
  });

  test("emits cumulative usage from one-shot turn events", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        {
          type: "turn_end",
          message: {
            role: "assistant",
            usage: {
              input: 10,
              output: 2,
              cacheWrite: 1,
              cacheRead: 3,
              cost: { total: 0.1 },
            },
          },
        },
        state,
      ),
    ).toEqual([
      {
        type: "usage_update",
        costUsd: 0.1,
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cacheCreationTokens: 1,
          cacheReadTokens: 3,
        },
      },
    ]);
    expect(
      mapPiEvent(
        {
          type: "turn_end",
          message: {
            role: "assistant",
            usage: {
              input: 5,
              output: 1,
              cacheWrite: 2,
              cacheRead: 4,
              cost: { total: 0.2 },
            },
          },
        },
        state,
      ),
    ).toEqual([
      {
        type: "usage_update",
        costUsd: 0.1 + 0.2,
        usage: {
          inputTokens: 15,
          outputTokens: 3,
          cacheCreationTokens: 3,
          cacheReadTokens: 7,
        },
      },
    ]);
  });

  test("preserves cumulative turn usage when agent_end omits totals", () => {
    const state = createPiEventState();
    mapPiEvent(
      {
        type: "turn_end",
        message: {
          usage: {
            input: 10,
            output: 2,
            cacheWrite: 1,
            cacheRead: 3,
            cost: { total: 0.1 },
          },
        },
      },
      state,
    );
    mapPiEvent({ type: "agent_end", result: "done" }, state);

    expect(completePendingDone(state)).toEqual({
      type: "done",
      result: "done",
      costUsd: 0.1,
      durationMs: 0,
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheCreationTokens: 1,
        cacheReadTokens: 3,
      },
    });
  });

  test("completes one-shot output when the agent settles", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        {
          type: "agent_end",
          result: "done",
          usage: { input: 2, output: 1, cost: { total: 0.3 } },
        },
        state,
      ),
    ).toEqual([]);
    expect(mapPiEvent({ type: "agent_settled" }, state)).toEqual([
      {
        type: "done",
        result: "done",
        costUsd: 0.3,
        durationMs: 0,
        usage: {
          inputTokens: 2,
          outputTokens: 1,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      },
    ]);
  });

  test("maps retry events", () => {
    expect(
      mapPiEvent(
        { type: "auto_retry_start", attempt: 2, maxRetries: 5, delayMs: 1000, error: "rate" },
        createPiEventState(),
      ),
    ).toEqual([{ type: "retry", attempt: 2, maxRetries: 5, delayMs: 1000, error: "rate" }]);
  });

  test("emits done from agent_end fallback usage", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        {
          type: "agent_end",
          result: "done",
          durationMs: 12,
          messages: [
            {
              role: "assistant",
              usage: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4, cost: { total: 0.5 } },
            },
          ],
        },
        state,
      ),
    ).toEqual([]);

    expect(completePendingDone(state)).toEqual({
      type: "done",
      result: "done",
      costUsd: 0.5,
      durationMs: 12,
      usage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
    });
  });

  test("falls back to aggregated assistant usage", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        {
          type: "agent_end",
          result: "done",
          messages: [
            { role: "assistant", usage: { input: 1, output: 2, cost: { total: 0.1 } } },
            {
              role: "assistant",
              usage: { input: 3, output: 4, cacheWrite: 5, cacheRead: 6, cost: { total: 0.2 } },
            },
          ],
        },
        state,
      ),
    ).toEqual([]);

    expect(completePendingDone(state)).toEqual({
      type: "done",
      result: "done",
      costUsd: 0.30000000000000004,
      durationMs: 0,
      usage: { inputTokens: 4, outputTokens: 6, cacheCreationTokens: 5, cacheReadTokens: 6 },
    });
  });

  test("emits errors and unknown events", () => {
    expect(
      mapPiEvent({ type: "response", success: false, error: "rejected" }, createPiEventState()),
    ).toEqual([{ type: "error", message: "rejected" }]);
    expect(mapPiEvent({ type: "extension_error", message: "bad" }, createPiEventState())).toEqual([
      { type: "error", message: "bad" },
    ]);
    expect(
      mapPiEvent(
        {
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "Subagent failed: rate limit",
            provider: "anthropic",
            model: "claude-sonnet",
            responseId: "msg_123",
            diagnostics: [{ message: "upstream 429" }],
          },
        },
        createPiEventState(),
      ),
    ).toEqual([
      {
        type: "error",
        message:
          "pi assistant message ended with error: Subagent failed: rate limit · anthropic/claude-sonnet/msg_123 · diagnostics: upstream 429",
      },
    ]);
    expect(
      mapPiEvent({ type: "message_end", message: { stopReason: "error" } }, createPiEventState()),
    ).toEqual([
      {
        type: "error",
        message:
          'pi assistant message ended with error: raw: {"type":"message_end","message":{"stopReason":"error"}}',
      },
    ]);
    expect(mapPiEvent({ type: "something_else" }, createPiEventState())).toEqual([
      { type: "unknown", eventType: "something_else", raw: { type: "something_else" } },
    ]);
  });
});
