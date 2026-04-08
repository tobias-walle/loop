export type AgentEvent =
  | { type: "session_start"; model: string; sessionId: string; tools: string[] }
  | { type: "text_delta"; text: string; parentToolUseId: string | null }
  | { type: "text_done"; text: string; parentToolUseId: string | null }
  | {
      type: "tool_start";
      toolId: string;
      tool: string;
      input: Record<string, unknown>;
      parentToolUseId: string | null;
    }
  | { type: "tool_done"; toolId: string; result: string; parentToolUseId: string | null }
  | { type: "retry"; attempt: number; maxRetries: number; delayMs: number; error: string }
  | { type: "rate_limit"; status: string; resetsAt: number }
  | { type: "error"; message: string }
  | { type: "done"; result: string; costUsd: number; durationMs: number; usage: TokenUsage }
  | {
      type: "task_started";
      taskId: string;
      toolUseId: string;
      description: string;
      prompt: string;
    }
  | {
      type: "task_done";
      taskId: string;
      toolUseId: string;
      status: string;
      summary: string;
      durationMs: number;
      model?: string;
      totalTokens?: number;
    }
  | { type: "unknown"; eventType: string; raw: unknown };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
};

/** A running agent session. */
export interface AgentSession {
  /** Async iterator of normalized events. */
  events: AsyncIterable<AgentEvent>;
  /** Inject a user message mid-session. */
  sendMessage(text: string): void;
  /** Kill the process. */
  abort(): void;
}

/** Factory that creates sessions. Injected into the runner. */
export interface AgentAdapter {
  spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession;
}

export interface AgentSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
}
