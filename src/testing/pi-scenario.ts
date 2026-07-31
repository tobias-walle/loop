import type { FakeProcessOperation, FakeProcessRun } from "./fake-process.js";

export interface PiUsage {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
  costUsd?: number;
}

export interface PiScenarioBuilder {
  session(options?: { id?: string; model?: string; tools?: string[] }): PiScenarioBuilder;
  text(text: string): PiScenarioBuilder;
  tool(options: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
    result?: unknown;
  }): PiScenarioBuilder;
  retry(options: {
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: string;
  }): PiScenarioBuilder;
  usage(usage: PiUsage): PiScenarioBuilder;
  complete(options: { result: string; durationMs?: number }): PiScenarioBuilder;
  fail(message: string): PiScenarioBuilder;
  raw(bytes: string | Uint8Array): PiScenarioBuilder;
  rawChunks(chunks: readonly (string | Uint8Array)[]): PiScenarioBuilder;
  checkpoint(name: string): PiScenarioBuilder;
  stderr(text: string): PiScenarioBuilder;
  exit(code: number, signal?: NodeJS.Signals): PiScenarioBuilder;
  spawnError(error: Error): PiScenarioBuilder;
  deferred(): PiScenarioBuilder;
  optional(): PiScenarioBuilder;
  build(): FakeProcessRun;
}

export function createPiScenario(): PiScenarioBuilder {
  const chunks: (string | Uint8Array)[] = [];
  const operations: FakeProcessOperation[] = [];
  let hasCheckpoint = false;
  const run: Omit<FakeProcessRun, "stdoutChunks" | "operations"> = {};

  const appendChunks = (values: readonly (string | Uint8Array)[]): void => {
    chunks.push(...values);
    operations.push({ type: "stdout", chunks: [...values] });
  };
  const record = (value: Record<string, unknown>): void => appendChunks([line(value)]);

  const builder: PiScenarioBuilder = {
    session(options = {}) {
      const id = options.id ?? "pi-session";
      const model = options.model ?? "pi-test";
      record({ type: "session", id });
      record({ type: "agent_start", model, tools: options.tools ?? [] });
      return builder;
    },
    text(text) {
      record({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: text },
      });
      record({
        type: "message_update",
        assistantMessageEvent: { type: "text_end", content: text },
      });
      return builder;
    },
    tool(options) {
      record({
        type: "tool_execution_start",
        toolCallId: options.id,
        toolName: options.name,
        args: options.input ?? {},
      });
      record({
        type: "tool_execution_end",
        toolCallId: options.id,
        result: options.result ?? "",
      });
      return builder;
    },
    retry(options) {
      record({
        type: "auto_retry_start",
        attempt: options.attempt,
        maxAttempts: options.maxRetries,
        delayMs: options.delayMs,
        errorMessage: options.error,
      });
      return builder;
    },
    usage(usage) {
      record({
        type: "turn_end",
        message: {
          role: "assistant",
          usage: {
            input: usage.input,
            output: usage.output,
            cacheWrite: usage.cacheCreation ?? 0,
            cacheRead: usage.cacheRead ?? 0,
            cost: { total: usage.costUsd ?? 0 },
          },
        },
      });
      return builder;
    },
    complete(options) {
      record({
        type: "agent_end",
        result: options.result,
        durationMs: options.durationMs ?? 1,
      });
      record({ type: "agent_settled" });
      return builder;
    },
    fail(message) {
      record({ type: "extension_error", message });
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
  return builder;
}

function line(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}
