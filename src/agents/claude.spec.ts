import { describe, expect, it } from "bun:test";
import { parseClaudeLine } from "./claude.js";

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

  it("handles malformed JSON gracefully", () => {
    const state = createState();
    const events = parseClaudeLine(
      "not valid json {{{",
      state.blocks,
      state.parents,
      state.toolIdToParent,
    );
    expect(events).toEqual([]);
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

  it("skips assistant events", () => {
    const events = parse({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(events).toEqual([]);
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
});
