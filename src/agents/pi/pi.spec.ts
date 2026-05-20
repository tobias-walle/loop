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

  test("emits done with usage and cost", () => {
    const state = createPiEventState();
    const events = mapPiEvent(
      {
        type: "agent_end",
        result: "done",
        durationMs: 12,
        usage: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4, cost: { total: 0.5 } },
      },
      state,
    );
    expect(events).toEqual([
      {
        type: "done",
        result: "done",
        costUsd: 0.5,
        durationMs: 12,
        usage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
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
