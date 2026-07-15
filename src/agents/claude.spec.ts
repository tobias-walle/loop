import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { parseClaudeLine, readLines, streamEvents } from "./claude.js";
import type { AgentEvent } from "./types.js";

function createState() {
  const blocks = new Map() as Parameters<typeof parseClaudeLine>[1];
  const parents = new Map() as Parameters<typeof parseClaudeLine>[2];
  const toolIdToParent = new Map() as Parameters<typeof parseClaudeLine>[3];
  return { blocks, parents, toolIdToParent };
}

function parse(line: string | object, state?: ReturnType<typeof createState>) {
  const s = state ?? createState();
  const raw = typeof line === "string" ? line : JSON.stringify(line);
  return parseClaudeLine(raw, s.blocks, s.parents, s.toolIdToParent);
}

function parseLine(line: object, state: ReturnType<typeof createState>) {
  return parseClaudeLine(JSON.stringify(line), state.blocks, state.parents, state.toolIdToParent);
}

describe("parseClaudeLine", () => {
  it("parses system/init to session_start", () => {
    const events = parse({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      tools: ["Bash", "Read", "Write"],
      model: "claude-sonnet-4-20250514",
      cwd: "/project",
    });

    expect(events).toEqual([
      {
        type: "session_start",
        model: "claude-sonnet-4-20250514",
        sessionId: "sess-1",
        tools: ["Bash", "Read", "Write"],
      },
    ]);
  });

  it("parses system/api_retry to retry", () => {
    const events = parse({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 10,
      retry_delay_ms: 1500,
      error: "rate_limit",
    });

    expect(events).toEqual([
      {
        type: "retry",
        attempt: 2,
        maxRetries: 10,
        delayMs: 1500,
        error: "rate_limit",
      },
    ]);
  });

  it("parses text content_block_delta to text_delta", () => {
    const state = createState();

    // First, start the text block
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // Then send a delta
    const events = parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello world" },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "text_delta",
        text: "Hello world",
        parentToolUseId: null,
      },
    ]);
  });

  it("parses content_block_stop for text blocks to text_done", () => {
    const state = createState();

    // Start text block
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // Delta
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Full text here" },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // Stop
    const events = parseLine(
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
        parent_tool_use_id: null,
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "text_done",
        text: "Full text here",
        parentToolUseId: null,
      },
    ]);
  });

  it("parses tool_use block start + input_json_delta + stop to tool_start", () => {
    const state = createState();

    // Start tool_use block
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_abc",
            name: "Read",
            input: {},
          },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // First JSON delta
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"file_pa' },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // Second JSON delta
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: 'th": "src/index.ts"}' },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // Stop - should emit tool_start with parsed input
    const events = parseLine(
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 1 },
        parent_tool_use_id: null,
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "tool_start",
        toolId: "toolu_abc",
        tool: "Read",
        input: { file_path: "src/index.ts" },
        parentToolUseId: null,
      },
    ]);
  });

  it("parses user (tool result) to tool_done", () => {
    const events = parse({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: "toolu_abc",
            type: "tool_result",
            content: "file contents here",
          },
        ],
      },
    });

    expect(events).toEqual([
      {
        type: "tool_done",
        toolId: "toolu_abc",
        result: "file contents here",
        parentToolUseId: null,
      },
    ]);
  });

  it("tool_done carries correct parentToolUseId from tool_start", () => {
    const state = createState();

    // Start a tool_use block with a parent
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_child",
            name: "Read",
            input: {},
          },
        },
        parent_tool_use_id: "toolu_parent_999",
      },
      state,
    );

    // Stop the block (emits tool_start)
    parseLine(
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
        parent_tool_use_id: "toolu_parent_999",
      },
      state,
    );

    // Now the user event with tool result should carry the parent
    const events = parseLine(
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_child",
              type: "tool_result",
              content: "some result",
            },
          ],
        },
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "tool_done",
        toolId: "toolu_child",
        result: "some result",
        parentToolUseId: "toolu_parent_999",
      },
    ]);
  });

  it("tool_done without prior tool_start defaults to null parentToolUseId", () => {
    const events = parse({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: "toolu_unknown",
            type: "tool_result",
            content: "result",
          },
        ],
      },
    });

    expect(events).toEqual([
      {
        type: "tool_done",
        toolId: "toolu_unknown",
        result: "result",
        parentToolUseId: null,
      },
    ]);
  });

  it("parses result/success to done", () => {
    const events = parse({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "All done.",
      duration_ms: 5000,
      total_cost_usd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 80,
      },
    });

    expect(events).toEqual([
      {
        type: "done",
        result: "All done.",
        costUsd: 0.05,
        durationMs: 5000,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 20,
          cacheReadTokens: 80,
        },
      },
    ]);
  });

  it("parses result with is_error to error", () => {
    const events = parse({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "Something went wrong",
      duration_ms: 1000,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    });

    expect(events).toEqual([
      {
        type: "error",
        message: "Something went wrong",
      },
    ]);
  });

  it("parses rate_limit_event", () => {
    const events = parse({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1774612800,
      },
    });

    expect(events).toEqual([
      {
        type: "rate_limit",
        status: "allowed",
        resetsAt: 1774612800,
      },
    ]);
  });

  it("reports malformed JSON as a protocol error", () => {
    const state = createState();
    const events = parseClaudeLine(
      "not valid json {{{",
      state.blocks,
      state.parents,
      state.toolIdToParent,
    );
    expect(events).toEqual([{ type: "error", message: "Claude emitted malformed JSON" }]);
  });

  it("handles empty line", () => {
    const state = createState();
    const events = parseClaudeLine("", state.blocks, state.parents, state.toolIdToParent);
    expect(events).toEqual([]);
  });

  it("passes through parent_tool_use_id for subagent events", () => {
    const state = createState();

    // Start a text block inside a subagent
    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        parent_tool_use_id: "toolu_parent_123",
      },
      state,
    );

    const deltaEvents = parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Subagent text" },
        },
        parent_tool_use_id: "toolu_parent_123",
      },
      state,
    );

    expect(deltaEvents).toEqual([
      {
        type: "text_delta",
        text: "Subagent text",
        parentToolUseId: "toolu_parent_123",
      },
    ]);

    const stopEvents = parseLine(
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
        parent_tool_use_id: "toolu_parent_123",
      },
      state,
    );

    expect(stopEvents).toEqual([
      {
        type: "text_done",
        text: "Subagent text",
        parentToolUseId: "toolu_parent_123",
      },
    ]);
  });

  it("skips assistant events without parent_tool_use_id (duplicates streaming content)", () => {
    const events = parse({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(events).toEqual([]);
  });

  it("extracts tool calls from subagent assistant events", () => {
    const state = createState();
    const events = parseLine(
      {
        type: "assistant",
        parent_tool_use_id: "toolu_parent_123",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_child_1",
              name: "Bash",
              input: { command: "find . -type f | head -5" },
            },
          ],
        },
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "tool_start",
        toolId: "toolu_child_1",
        tool: "Bash",
        input: { command: "find . -type f | head -5" },
        parentToolUseId: "toolu_parent_123",
      },
    ]);

    // Verify parent mapping is stored for tool_done resolution
    expect(state.toolIdToParent.get("toolu_child_1")).toBe("toolu_parent_123");
  });

  it("extracts multiple tool calls from a single subagent assistant event", () => {
    const events = parse({
      type: "assistant",
      parent_tool_use_id: "toolu_parent_456",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read both files" },
          {
            type: "tool_use",
            id: "toolu_a",
            name: "Read",
            input: { file_path: "src/a.ts" },
          },
          {
            type: "tool_use",
            id: "toolu_b",
            name: "Read",
            input: { file_path: "src/b.ts" },
          },
        ],
      },
    });

    expect(events).toEqual([
      {
        type: "tool_start",
        toolId: "toolu_a",
        tool: "Read",
        input: { file_path: "src/a.ts" },
        parentToolUseId: "toolu_parent_456",
      },
      {
        type: "tool_start",
        toolId: "toolu_b",
        tool: "Read",
        input: { file_path: "src/b.ts" },
        parentToolUseId: "toolu_parent_456",
      },
    ]);
  });

  it("handles tool_use with empty input", () => {
    const state = createState();

    parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_xyz",
            name: "Bash",
            input: {},
          },
        },
        parent_tool_use_id: null,
      },
      state,
    );

    // No input_json_delta, go straight to stop
    const events = parseLine(
      {
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
        parent_tool_use_id: null,
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "tool_start",
        toolId: "toolu_xyz",
        tool: "Bash",
        input: {},
        parentToolUseId: null,
      },
    ]);
  });

  it("emits unknown for unrecognized top-level event types", () => {
    const raw = { type: "new_feature_event", data: { foo: "bar" } };
    const events = parse(raw);
    expect(events).toEqual([
      {
        type: "unknown",
        eventType: "new_feature_event",
        raw,
      },
    ]);
  });

  it("emits unknown for unrecognized system subtypes", () => {
    const raw = { type: "system", subtype: "new_subtype", info: "something" };
    const events = parse(raw);
    expect(events).toEqual([
      {
        type: "unknown",
        eventType: "system/new_subtype",
        raw,
      },
    ]);
  });

  it("does not emit unknown for known stream_event subtypes", () => {
    const state = createState();
    const events = parseLine(
      {
        type: "stream_event",
        event: { type: "message_start", message: { model: "test", id: "msg_1" } },
        parent_tool_use_id: null,
      },
      state,
    );
    expect(events).toEqual([]);
  });

  it("emits unknown for unrecognized stream_event subtypes", () => {
    const raw = {
      type: "stream_event",
      event: { type: "new_stream_type", data: 123 },
      parent_tool_use_id: null,
    };
    const events = parse(raw);
    expect(events).toEqual([
      {
        type: "unknown",
        eventType: "stream_event/new_stream_type",
        raw,
      },
    ]);
  });

  it("returns empty for non-object JSON", () => {
    const state = createState();
    expect(
      parseClaudeLine('"just a string"', state.blocks, state.parents, state.toolIdToParent),
    ).toEqual([]);
    expect(parseClaudeLine("42", state.blocks, state.parents, state.toolIdToParent)).toEqual([]);
    expect(parseClaudeLine("null", state.blocks, state.parents, state.toolIdToParent)).toEqual([]);
    expect(parseClaudeLine("true", state.blocks, state.parents, state.toolIdToParent)).toEqual([]);
  });

  it("returns empty for object without type field", () => {
    const events = parse({ foo: "bar" });
    expect(events).toEqual([]);
  });

  it("parses system/task_started to task_started", () => {
    const events = parse({
      type: "system",
      subtype: "task_started",
      task_id: "abc123",
      tool_use_id: "toolu_456",
      description: "Say hi",
      task_type: "local_agent",
      prompt: "Just say hi",
    });
    expect(events).toEqual([
      {
        type: "task_started",
        taskId: "abc123",
        toolUseId: "toolu_456",
        description: "Say hi",
        prompt: "Just say hi",
      },
    ]);
  });

  it("parses system/task_notification to task_done", () => {
    const events = parse({
      type: "system",
      subtype: "task_notification",
      task_id: "abc123",
      tool_use_id: "toolu_456",
      status: "completed",
      output_file: "",
      summary: "Said hi",
      usage: { total_tokens: 100, tool_uses: 0, duration_ms: 2500 },
    });
    expect(events).toEqual([
      {
        type: "task_done",
        taskId: "abc123",
        toolUseId: "toolu_456",
        status: "completed",
        summary: "Said hi",
        model: undefined,
        totalTokens: 100,
        durationMs: 2500,
      },
    ]);
  });
});

describe("readLines", () => {
  async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
    const result: string[] = [];
    for await (const line of gen) {
      result.push(line);
    }
    return result;
  }

  it("yields complete lines from a single chunk", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.end("line1\nline2\nline3\n");
    expect(await promise).toEqual(["line1", "line2", "line3"]);
  });

  it("handles data split across multiple chunks", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.write("hel");
    stream.write("lo\nwor");
    stream.write("ld\n");
    stream.end();
    expect(await promise).toEqual(["hello", "world"]);
  });

  it("yields trailing data without newline on stream end", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.end("line1\nno-trailing-newline");
    expect(await promise).toEqual(["line1", "no-trailing-newline"]);
  });

  it("handles empty stream", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.end();
    expect(await promise).toEqual([]);
  });

  it("handles stream with only newlines", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.end("\n\n\n");
    expect(await promise).toEqual(["", "", ""]);
  });

  it("handles large number of lines", async () => {
    const stream = new PassThrough();
    const expected = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    const promise = collect(readLines(stream));
    stream.end(`${expected.join("\n")}\n`);
    expect(await promise).toEqual(expected);
  });

  it("handles chunks arriving with delays", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));

    stream.write("first\n");
    await new Promise((r) => setTimeout(r, 10));
    stream.write("second\n");
    await new Promise((r) => setTimeout(r, 10));
    stream.end("third\n");

    expect(await promise).toEqual(["first", "second", "third"]);
  });

  it("handles stream error gracefully", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.write("before-error\n");
    stream.destroy(new Error("test error"));
    const lines = await promise;
    expect(lines).toEqual(["before-error"]);
  });

  it("handles multiple lines in a single chunk", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.end("a\nb\nc\nd\n");
    expect(await promise).toEqual(["a", "b", "c", "d"]);
  });

  it("handles line split exactly at chunk boundary", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.write("abc\n");
    stream.write("def\n");
    stream.end();
    expect(await promise).toEqual(["abc", "def"]);
  });

  it("unblocks when stream is destroyed without error", async () => {
    const stream = new PassThrough();
    const promise = collect(readLines(stream));
    stream.write("before\n");
    // destroy() without error emits 'close' but not 'end'
    stream.destroy();
    const lines = await promise;
    expect(lines).toEqual(["before"]);
  });
});

describe("streamEvents", () => {
  async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
    const result: AgentEvent[] = [];
    for await (const event of gen) {
      result.push(event);
    }
    return result;
  }

  function ndjson(...objects: object[]): string {
    return `${objects.map((o) => JSON.stringify(o)).join("\n")}\n`;
  }

  it("parses a complete session from NDJSON stream", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    stream.end(
      ndjson(
        {
          type: "system",
          subtype: "init",
          session_id: "s1",
          tools: ["Bash"],
          model: "claude-sonnet-4-20250514",
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Done!",
          duration_ms: 1000,
          total_cost_usd: 0.01,
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ),
    );

    const events = await promise;
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("session_start");
    expect(events[1].type).toBe("done");
  });

  it("stops yielding after a done event", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    stream.write(
      ndjson({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done!",
        duration_ms: 1000,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    // Write more data after done — should be ignored
    stream.write(
      ndjson({
        type: "system",
        subtype: "init",
        session_id: "s2",
        tools: [],
        model: "test",
      }),
    );
    stream.end();

    const events = await promise;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("done");
  });

  it("stops yielding after an error event", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    stream.end(
      ndjson(
        {
          type: "result",
          subtype: "error",
          is_error: true,
          result: "Something broke",
          duration_ms: 500,
          total_cost_usd: 0,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
        {
          type: "system",
          subtype: "init",
          session_id: "s2",
          tools: [],
          model: "test",
        },
      ),
    );

    const events = await promise;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("skips empty and whitespace lines", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    const initLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "s1",
      tools: [],
      model: "test",
    });
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      duration_ms: 100,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    stream.end(`\n  \n${initLine}\n\n${resultLine}\n`);

    const events = await promise;
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("session_start");
    expect(events[1].type).toBe("done");
  });

  it("stops with an error on malformed JSON", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      duration_ms: 100,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    stream.end(`not-json\n${resultLine}\n`);

    expect(await promise).toEqual([{ type: "error", message: "Claude emitted malformed JSON" }]);
  });

  it("handles streaming text deltas", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    stream.end(
      ndjson(
        {
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          parent_tool_use_id: null,
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hello " },
          },
          parent_tool_use_id: null,
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "world" },
          },
          parent_tool_use_id: null,
        },
        {
          type: "stream_event",
          event: { type: "content_block_stop", index: 0 },
          parent_tool_use_id: null,
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Hello world",
          duration_ms: 100,
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      ),
    );

    const events = await promise;
    expect(events.map((e) => e.type)).toEqual(["text_delta", "text_delta", "text_done", "done"]);
  });

  it("handles data arriving in small chunks across line boundaries", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      duration_ms: 100,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    // Write the line character by character
    for (const char of `${line}\n`) {
      stream.write(char);
    }
    stream.end();

    const events = await promise;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("done");
  });

  it("handles empty stream", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));
    stream.end();
    expect(await promise).toEqual([]);
  });

  it("ends cleanly when stream closes without done event", async () => {
    const stream = new PassThrough();
    const promise = collect(streamEvents(stream));

    stream.write(
      ndjson({
        type: "system",
        subtype: "init",
        session_id: "s1",
        tools: [],
        model: "test",
        cwd: "/project",
      }),
    );
    // Simulate crash: stream closes without emitting a result/done event
    stream.destroy();

    const events = await promise;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("session_start");
  });
});

describe("subagent fixture (examples/claude/subagent.jsonl)", () => {
  function replayFixture(): AgentEvent[] {
    const fixturePath = resolve(import.meta.dir, "../../examples/claude/subagent.jsonl");
    const content = readFileSync(fixturePath, "utf-8");
    const state = createState();
    const taskModels = new Map<string, string>();
    const events: AgentEvent[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      events.push(
        ...parseClaudeLine(trimmed, state.blocks, state.parents, state.toolIdToParent, taskModels),
      );
    }
    return events;
  }

  it("produces no unknown events", () => {
    const events = replayFixture();
    const unknowns = events.filter((e) => e.type === "unknown");
    expect(unknowns).toEqual([]);
  });

  it("emits session_start as the first event", () => {
    const events = replayFixture();
    expect(events[0].type).toBe("session_start");
  });

  it("emits task_started and task_done for the subagent", () => {
    const events = replayFixture();
    const taskStarted = events.filter((e) => e.type === "task_started");
    const taskDone = events.filter((e) => e.type === "task_done");
    expect(taskStarted).toHaveLength(1);
    expect(taskDone).toHaveLength(1);
    if (taskStarted[0].type === "task_started" && taskDone[0].type === "task_done") {
      expect(taskStarted[0].toolUseId).toBe(taskDone[0].toolUseId);
    }
  });

  it("extracts subagent tool calls from assistant events", () => {
    const events = replayFixture();
    const subagentTools = events.filter(
      (e) => e.type === "tool_start" && e.parentToolUseId !== null,
    );
    // The subagent uses: Bash, Bash, Read (3 tool calls)
    expect(subagentTools).toHaveLength(3);
    expect(subagentTools.map((e) => (e.type === "tool_start" ? e.tool : ""))).toEqual([
      "Bash",
      "Bash",
      "Read",
    ]);
  });

  it("resolves tool_done parentToolUseId for subagent tools", () => {
    const events = replayFixture();
    const subagentToolDones = events.filter(
      (e) => e.type === "tool_done" && e.parentToolUseId !== null,
    );
    // 3 tool results from the subagent
    expect(subagentToolDones).toHaveLength(3);
  });

  it("includes model and totalTokens in task_done", () => {
    const events = replayFixture();
    const taskDone = events.find((e) => e.type === "task_done");
    expect(taskDone).toBeDefined();
    if (taskDone?.type === "task_done") {
      expect(taskDone.model).toBe("claude-haiku-4-5-20251001");
      expect(taskDone.totalTokens).toBe(16934);
    }
  });

  it("ends with a done event", () => {
    const events = replayFixture();
    const last = events[events.length - 1];
    expect(last.type).toBe("done");
  });
});
