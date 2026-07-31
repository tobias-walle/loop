import type { FakeProcessOperation, FakeProcessRun } from "./fake-process.js";

export interface ClaudeUsage {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

export interface ClaudeScenarioBuilder {
  session(options?: { id?: string; model?: string; tools?: string[] }): ClaudeScenarioBuilder;
  text(chunks: string | readonly string[], parentToolUseId?: string | null): ClaudeScenarioBuilder;
  tool(options: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
    result?: string;
    parentToolUseId?: string | null;
  }): ClaudeScenarioBuilder;
  subagent(options: {
    taskId: string;
    toolUseId: string;
    description: string;
    prompt: string;
    summary: string;
    model?: string;
    status?: string;
    durationMs?: number;
    totalTokens?: number;
  }): ClaudeScenarioBuilder;
  retry(options: {
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: string;
  }): ClaudeScenarioBuilder;
  usage(usage: ClaudeUsage): ClaudeScenarioBuilder;
  complete(options: {
    result: string;
    durationMs?: number;
    costUsd?: number;
    usage?: ClaudeUsage;
  }): ClaudeScenarioBuilder;
  fail(message: string): ClaudeScenarioBuilder;
  raw(bytes: string | Uint8Array): ClaudeScenarioBuilder;
  rawChunks(chunks: readonly (string | Uint8Array)[]): ClaudeScenarioBuilder;
  checkpoint(name: string): ClaudeScenarioBuilder;
  stderr(text: string): ClaudeScenarioBuilder;
  exit(code: number, signal?: NodeJS.Signals): ClaudeScenarioBuilder;
  spawnError(error: Error): ClaudeScenarioBuilder;
  deferred(): ClaudeScenarioBuilder;
  optional(): ClaudeScenarioBuilder;
  build(): FakeProcessRun;
}

export function createClaudeScenario(): ClaudeScenarioBuilder {
  const chunks: (string | Uint8Array)[] = [];
  const operations: FakeProcessOperation[] = [];
  let hasCheckpoint = false;
  let blockIndex = 0;
  let configuredUsage: ClaudeUsage = { input: 0, output: 0 };
  const run: Omit<FakeProcessRun, "stdoutChunks" | "operations"> = {};

  const appendChunks = (values: readonly (string | Uint8Array)[]): void => {
    chunks.push(...values);
    operations.push({ type: "stdout", chunks: [...values] });
  };
  const record = (value: Record<string, unknown>): void => appendChunks([line(value)]);

  const builder: ClaudeScenarioBuilder = {
    session(options = {}) {
      record({
        type: "system",
        subtype: "init",
        session_id: options.id ?? "claude-session",
        tools: options.tools ?? [],
        model: options.model ?? "claude-test",
      });
      return builder;
    },
    text(text, parentToolUseId = null) {
      const textChunks = typeof text === "string" ? [text] : text;
      const index = blockIndex++;
      stream(
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        },
        parentToolUseId,
      );
      for (const chunk of textChunks) {
        stream(
          { type: "content_block_delta", index, delta: { type: "text_delta", text: chunk } },
          parentToolUseId,
        );
      }
      stream({ type: "content_block_stop", index }, parentToolUseId);
      return builder;
    },
    tool(options) {
      const parent = options.parentToolUseId ?? null;
      const index = blockIndex++;
      stream(
        {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: options.id, name: options.name, input: {} },
        },
        parent,
      );
      stream(
        {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(options.input ?? {}) },
        },
        parent,
      );
      stream({ type: "content_block_stop", index }, parent);
      record({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: options.id, content: options.result ?? "" },
          ],
        },
      });
      return builder;
    },
    subagent(options) {
      record({
        type: "system",
        subtype: "task_started",
        task_id: options.taskId,
        tool_use_id: options.toolUseId,
        description: options.description,
        prompt: options.prompt,
      });
      record({
        type: "assistant",
        parent_tool_use_id: options.toolUseId,
        message: { model: options.model ?? "claude-subagent", content: [] },
      });
      record({
        type: "system",
        subtype: "task_notification",
        task_id: options.taskId,
        tool_use_id: options.toolUseId,
        status: options.status ?? "completed",
        summary: options.summary,
        usage: {
          duration_ms: options.durationMs ?? 1,
          ...(options.totalTokens === undefined ? {} : { total_tokens: options.totalTokens }),
        },
      });
      return builder;
    },
    retry(options) {
      record({
        type: "system",
        subtype: "api_retry",
        attempt: options.attempt,
        max_retries: options.maxRetries,
        retry_delay_ms: options.delayMs,
        error: options.error,
      });
      return builder;
    },
    usage(usage) {
      configuredUsage = { ...usage };
      return builder;
    },
    complete(options) {
      const usage = options.usage ?? configuredUsage;
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        result: options.result,
        duration_ms: options.durationMs ?? 1,
        total_cost_usd: options.costUsd ?? 0,
        usage: rawUsage(usage),
      });
      return builder;
    },
    fail(message) {
      record({
        type: "result",
        subtype: "error",
        is_error: true,
        result: message,
        duration_ms: 1,
        total_cost_usd: 0,
        usage: rawUsage(configuredUsage),
      });
      return builder;
    },
    raw(bytes) {
      appendChunks([bytes]);
      return builder;
    },
    rawChunks(values) {
      appendChunks(values);
      return builder;
    },
    checkpoint(name) {
      hasCheckpoint = true;
      operations.push({ type: "checkpoint", name });
      return builder;
    },
    stderr(text) {
      run.stderr = text;
      return builder;
    },
    exit(code, signal) {
      run.exitCode = code;
      if (signal !== undefined) run.signal = signal;
      return builder;
    },
    spawnError(error) {
      run.spawnError = error;
      return builder;
    },
    deferred() {
      run.deferred = true;
      return builder;
    },
    optional() {
      run.optional = true;
      return builder;
    },
    build() {
      return {
        ...run,
        stdoutChunks: [...chunks],
        ...(hasCheckpoint ? { operations: [...operations] } : {}),
      };
    },
  };

  function stream(event: Record<string, unknown>, parentToolUseId: string | null): void {
    record({ type: "stream_event", event, parent_tool_use_id: parentToolUseId });
  }

  return builder;
}

function rawUsage(usage: ClaudeUsage): Record<string, number> {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_creation_input_tokens: usage.cacheCreation ?? 0,
    cache_read_input_tokens: usage.cacheRead ?? 0,
  };
}

function line(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}
