import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { createPiRpcAdapter } from "./adapter";
import { createPiEventState, mapPiEvent } from "./events";
import { readJsonLines, writeRpcCommand } from "./rpc";

describe("pi RPC JSONL", () => {
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

  test("writes prompt steer and abort commands", () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on("data", (chunk) => chunks.push(chunk.toString()));
    writeRpcCommand(stream, { type: "prompt", message: "hi" });
    writeRpcCommand(stream, { type: "steer", message: "go" });
    writeRpcCommand(stream, { type: "abort" });
    expect(chunks.join("")).toBe(
      '{"type":"prompt","message":"hi"}\n{"type":"steer","message":"go"}\n{"type":"abort"}\n',
    );
  });
});

describe("pi RPC adapter", () => {
  test("sends prompt, steer, and abort commands", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const logPath = path.join(dir, "commands.jsonl");
    const argvPath = path.join(dir, "argv.json");
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
process.stdin.on("data", (chunk) => {
  fs.appendFileSync(${JSON.stringify(logPath)}, chunk);
});
process.on("SIGTERM", () => setTimeout(() => process.exit(0), 25));
setTimeout(() => {}, 10000);
`,
    );

    const session = createPiRpcAdapter({ command: process.execPath, args: [scriptPath] }).spawn(
      "hello",
    );
    session.sendMessage("steer now");
    for (let attempt = 0; attempt < 20 && !fs.existsSync(logPath); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    session.abort();
    await session.exited;

    expect(JSON.parse(fs.readFileSync(argvPath, "utf-8"))).toEqual([
      "--no-session",
      "--mode",
      "rpc",
    ]);

    const commands = fs
      .readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(commands).toEqual([
      { type: "prompt", message: "hello" },
      { type: "steer", message: "steer now" },
      { type: "abort" },
    ]);
  });

  test("rejects --mode in args", () => {
    expect(() => createPiRpcAdapter({ args: ["--mode", "json"] })).toThrow("does not allow");
  });

  test("requests turn stats for live usage and final stats before done", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const logPath = path.join(dir, "commands.jsonl");
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `import fs from "node:fs";
process.stdin.on("data", (chunk) => {
  fs.appendFileSync(${JSON.stringify(logPath)}, chunk);
  for (const line of chunk.toString().trim().split("\\n")) {
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type === "prompt") {
      process.stdout.write(JSON.stringify({ type: "turn_end", message: { role: "assistant" }, toolResults: [] }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_end", result: "done", messages: [] }) + "\\n");
    }
    if (command.type === "get_session_stats") {
      process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "get_session_stats", success: true, data: { tokens: { input: 7, output: 8, cacheWrite: 9, cacheRead: 10 }, cost: 0.11 } }) + "\\n");
    }
  }
});
setTimeout(() => {}, 10000);
`,
    );

    const session = createPiRpcAdapter({ command: process.execPath, args: [scriptPath] }).spawn(
      "hello",
    );
    const events = [];
    for await (const event of session.events) events.push(event);
    await session.exited;

    const commands = fs
      .readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(commands).toContainEqual({ type: "get_session_stats", id: "loop-turn-stats" });
    expect(commands).toContainEqual({ type: "get_session_stats", id: "loop-final-stats" });
    expect(events).toEqual([
      {
        type: "usage_update",
        costUsd: 0.11,
        usage: { inputTokens: 7, outputTokens: 8, cacheCreationTokens: 9, cacheReadTokens: 10 },
      },
      {
        type: "done",
        result: "done",
        costUsd: 0.11,
        durationMs: 0,
        usage: { inputTokens: 7, outputTokens: 8, cacheCreationTokens: 9, cacheReadTokens: 10 },
      },
    ]);
  });

  test("does not duplicate --no-session from configured args", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pi-adapter-test-"));
    const argvPath = path.join(dir, "argv.json");
    const scriptPath = path.join(dir, "fake-pi.js");
    fs.writeFileSync(
      scriptPath,
      `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
setTimeout(() => process.exit(0), 25);
`,
    );

    const session = createPiRpcAdapter({
      command: process.execPath,
      args: [scriptPath, "--no-session"],
    }).spawn("hello");
    await session.exited;

    expect(JSON.parse(fs.readFileSync(argvPath, "utf-8"))).toEqual([
      "--no-session",
      "--mode",
      "rpc",
    ]);
  });
});

describe("pi event mapping", () => {
  test("maps agent_start to synthetic session_start", () => {
    expect(mapPiEvent({ type: "agent_start" }, createPiEventState())).toEqual([
      { type: "session_start", model: "pi", sessionId: "pi-rpc", tools: [] },
    ]);
  });

  test("updates session model from message_start", () => {
    const state = createPiEventState();
    expect(mapPiEvent({ type: "agent_start" }, state)).toEqual([
      { type: "session_start", model: "pi", sessionId: "pi-rpc", tools: [] },
    ]);
    expect(mapPiEvent({ type: "message_start", message: { model: "gpt-5.5" } }, state)).toEqual([
      { type: "session_start", model: "gpt-5.5", sessionId: "pi-rpc", tools: [] },
    ]);
    expect(mapPiEvent({ type: "message_start", message: { model: "gpt-5.5" } }, state)).toEqual([]);
  });

  test("maps text deltas and text end", () => {
    const state = createPiEventState();
    expect(
      mapPiEvent(
        { type: "message_update", assistantMessageEvent: { type: "text_delta", text: "hel" } },
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

  test("maps retry events", () => {
    expect(
      mapPiEvent(
        { type: "auto_retry_start", attempt: 2, maxRetries: 5, delayMs: 1000, error: "rate" },
        createPiEventState(),
      ),
    ).toEqual([{ type: "retry", attempt: 2, maxRetries: 5, delayMs: 1000, error: "rate" }]);
  });

  test("emits done from final session stats after agent_end", () => {
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

    expect(
      mapPiEvent(
        {
          id: "loop-final-stats",
          type: "response",
          command: "get_session_stats",
          success: true,
          data: {
            tokens: { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 },
            cost: 1.25,
          },
        },
        state,
      ),
    ).toEqual([
      {
        type: "done",
        result: "done",
        costUsd: 1.25,
        durationMs: 12,
        usage: { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40 },
      },
    ]);
  });

  test("falls back to aggregated assistant usage when final stats fail", () => {
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

    expect(
      mapPiEvent(
        {
          id: "loop-final-stats",
          type: "response",
          command: "get_session_stats",
          success: false,
          error: "stats unavailable",
        },
        state,
      ),
    ).toEqual([
      {
        type: "done",
        result: "done",
        costUsd: 0.30000000000000004,
        durationMs: 0,
        usage: { inputTokens: 4, outputTokens: 6, cacheCreationTokens: 5, cacheReadTokens: 6 },
      },
    ]);
  });

  test("emits errors and unknown events", () => {
    expect(
      mapPiEvent({ type: "response", success: false, error: "rejected" }, createPiEventState()),
    ).toEqual([{ type: "error", message: "rejected" }]);
    expect(mapPiEvent({ type: "extension_error", message: "bad" }, createPiEventState())).toEqual([
      { type: "error", message: "bad" },
    ]);
    expect(mapPiEvent({ type: "something_else" }, createPiEventState())).toEqual([
      { type: "unknown", eventType: "something_else", raw: { type: "something_else" } },
    ]);
  });
});
