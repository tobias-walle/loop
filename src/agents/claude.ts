import { type ChildProcess, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "./types.js";

// Claude NDJSON event types (internal, not exported)
type ClaudeEvent =
  | {
      type: "system";
      subtype: "init";
      session_id: string;
      tools: string[];
      model: string;
    }
  | {
      type: "system";
      subtype: "api_retry";
      attempt: number;
      max_retries: number;
      retry_delay_ms: number;
      error: string;
    }
  | {
      type: "system";
      subtype: "task_started";
      task_id: string;
      tool_use_id: string;
      description: string;
      prompt: string;
    }
  | {
      type: "system";
      subtype: "task_notification";
      task_id: string;
      tool_use_id: string;
      status: string;
      summary: string;
      usage: { duration_ms: number };
    }
  | {
      type: "system";
      subtype: "task_progress";
      task_id: string;
      tool_use_id: string;
    }
  | {
      type: "stream_event";
      event: StreamEvent;
      parent_tool_use_id: string | null;
    }
  | {
      type: "user";
      message: {
        role: "user";
        content: Array<{
          tool_use_id: string;
          type: "tool_result";
          content: string;
        }>;
      };
    }
  | {
      type: "rate_limit_event";
      rate_limit_info: {
        status: string;
        resetsAt: number;
      };
    }
  | {
      type: "result";
      subtype: string;
      is_error: boolean;
      result: string;
      duration_ms: number;
      total_cost_usd: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
  | {
      type: "assistant";
      parent_tool_use_id: string | null;
      message: {
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
        >;
      };
    };

type StreamEvent =
  | { type: "message_start"; message: { model: string; id: string } }
  | {
      type: "content_block_start";
      index: number;
      content_block:
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: object };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string } }
  | { type: "message_stop" };

type BlockState =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; inputJson: string };

/**
 * Parse a single NDJSON line from Claude and translate it into AgentEvents.
 * Returns an array because one line can produce zero or more events.
 */
export function parseClaudeLine(
  line: string,
  blocksByIndex: Map<number, BlockState>,
  parentToolUseIdByIndex: Map<number, string | null>,
  toolIdToParent: Map<string, string | null>,
): AgentEvent[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
    return [];
  }

  const events: AgentEvent[] = [];
  const typed = parsed as unknown as ClaudeEvent;

  switch (typed.type) {
    case "system": {
      if (typed.subtype === "init") {
        events.push({
          type: "session_start",
          model: typed.model,
          sessionId: typed.session_id,
          tools: typed.tools,
        });
      } else if (typed.subtype === "api_retry") {
        events.push({
          type: "retry",
          attempt: typed.attempt,
          maxRetries: typed.max_retries,
          delayMs: typed.retry_delay_ms,
          error: typed.error,
        });
      } else if (typed.subtype === "task_started") {
        events.push({
          type: "task_started",
          taskId: typed.task_id,
          toolUseId: typed.tool_use_id,
          description: typed.description,
          prompt: typed.prompt,
        });
      } else if (typed.subtype === "task_notification") {
        events.push({
          type: "task_done",
          taskId: typed.task_id,
          toolUseId: typed.tool_use_id,
          status: typed.status,
          summary: typed.summary,
          durationMs: typed.usage.duration_ms,
        });
      } else if (typed.subtype === "task_progress") {
        // Subagent progress updates — tool calls are already extracted
        // from "assistant" events, so no additional events needed.
      } else {
        events.push({
          type: "unknown",
          eventType: `system/${String(parsed.subtype)}`,
          raw: parsed,
        });
      }
      break;
    }

    case "stream_event": {
      const parentToolUseId = typed.parent_tool_use_id ?? null;
      const evt = typed.event;

      switch (evt.type) {
        case "content_block_start": {
          const block = evt.content_block;
          parentToolUseIdByIndex.set(evt.index, parentToolUseId);
          if (block.type === "text") {
            blocksByIndex.set(evt.index, { kind: "text", text: "" });
          } else if (block.type === "tool_use") {
            blocksByIndex.set(evt.index, {
              kind: "tool_use",
              id: block.id,
              name: block.name,
              inputJson: "",
            });
            toolIdToParent.set(block.id, parentToolUseId);
          }
          break;
        }

        case "content_block_delta": {
          const block = blocksByIndex.get(evt.index);
          if (!block) break;

          if (evt.delta.type === "text_delta" && block.kind === "text") {
            block.text += evt.delta.text;
            events.push({
              type: "text_delta",
              text: evt.delta.text,
              parentToolUseId: parentToolUseIdByIndex.get(evt.index) ?? null,
            });
          } else if (evt.delta.type === "input_json_delta" && block.kind === "tool_use") {
            block.inputJson += evt.delta.partial_json;
          }
          break;
        }

        case "content_block_stop": {
          const block = blocksByIndex.get(evt.index);
          const pId = parentToolUseIdByIndex.get(evt.index) ?? null;
          if (!block) break;

          if (block.kind === "text") {
            events.push({
              type: "text_done",
              text: block.text,
              parentToolUseId: pId,
            });
          } else if (block.kind === "tool_use") {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(block.inputJson || "{}");
            } catch {
              // If input JSON is malformed, use empty object
            }
            events.push({
              type: "tool_start",
              toolId: block.id,
              tool: block.name,
              input,
              parentToolUseId: pId,
            });
          }

          blocksByIndex.delete(evt.index);
          parentToolUseIdByIndex.delete(evt.index);
          break;
        }

        // message_start, message_delta, message_stop: structural stream framing, no events needed
        case "message_start":
        case "message_delta":
        case "message_stop":
          break;

        default:
          events.push({
            type: "unknown",
            eventType: `stream_event/${String((evt as { type: string }).type)}`,
            raw: parsed,
          });
          break;
      }
      break;
    }

    case "user": {
      const content = typed.message?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === "tool_result") {
            const parentId = toolIdToParent.get(item.tool_use_id) ?? null;
            events.push({
              type: "tool_done",
              toolId: item.tool_use_id,
              result:
                typeof item.content === "string" ? item.content : JSON.stringify(item.content),
              parentToolUseId: parentId,
            });
          }
        }
      }
      break;
    }

    case "rate_limit_event": {
      events.push({
        type: "rate_limit",
        status: typed.rate_limit_info.status,
        resetsAt: typed.rate_limit_info.resetsAt,
      });
      break;
    }

    case "result": {
      if (typed.is_error) {
        events.push({
          type: "error",
          message: typed.result,
        });
      } else {
        events.push({
          type: "done",
          result: typed.result,
          costUsd: typed.total_cost_usd,
          durationMs: typed.duration_ms,
          usage: {
            inputTokens: typed.usage.input_tokens,
            outputTokens: typed.usage.output_tokens,
            cacheCreationTokens: typed.usage.cache_creation_input_tokens,
            cacheReadTokens: typed.usage.cache_read_input_tokens,
          },
        });
      }
      break;
    }

    // "assistant" events from the main agent duplicate content already streamed
    // via "stream_event". But subagent messages (parent_tool_use_id set) only
    // arrive as "assistant" events — extract tool calls and text from those.
    case "assistant": {
      const parentId = typed.parent_tool_use_id ?? null;
      if (parentId === null) break;

      for (const block of typed.message.content) {
        if (block.type === "tool_use") {
          toolIdToParent.set(block.id, parentId);
          events.push({
            type: "tool_start",
            toolId: block.id,
            tool: block.name,
            input: block.input,
            parentToolUseId: parentId,
          });
        }
      }
      break;
    }

    default:
      events.push({ type: "unknown", eventType: parsed.type as string, raw: parsed });
      break;
  }

  return events;
}

/**
 * Async iterator that reads from a Node.js readable stream and yields
 * individual lines (splitting on newline boundaries). Handles buffering
 * across chunk boundaries and drains remaining data on stream end.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  let buffer = "";
  let streamEnded = false;

  const lines: string[] = [];
  let resolve: (() => void) | null = null;

  const flush = () => {
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      lines.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf("\n");
    }
  };

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString();
    flush();
    if (lines.length > 0 && resolve) {
      resolve();
      resolve = null;
    }
  };

  const onEnd = () => {
    streamEnded = true;
    if (resolve) {
      resolve();
      resolve = null;
    }
  };

  const onError = () => {
    streamEnded = true;
    if (resolve) {
      resolve();
      resolve = null;
    }
  };

  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);

  try {
    while (true) {
      if (lines.length > 0) {
        yield lines.shift() as string;
        continue;
      }

      if (streamEnded) {
        // Drain remaining buffer as a final line
        if (buffer.length > 0) {
          const remaining = buffer;
          buffer = "";
          yield remaining;
        }
        return;
      }

      // Wait for more data or stream end
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  } finally {
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("error", onError);
  }
}

/**
 * Async generator that reads NDJSON lines from a process stdout and
 * yields parsed AgentEvents. Terminates on "done" or "error" events.
 */
export async function* streamEvents(stdout: Readable): AsyncGenerator<AgentEvent> {
  const blocksByIndex = new Map<number, BlockState>();
  const parentToolUseIdByIndex = new Map<number, string | null>();
  const toolIdToParent = new Map<string, string | null>();

  for await (const line of readLines(stdout)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const events = parseClaudeLine(trimmed, blocksByIndex, parentToolUseIdByIndex, toolIdToParent);
    for (const event of events) {
      yield event;
      if (event.type === "done" || event.type === "error") {
        return;
      }
    }
  }
}

export interface ClaudeAdapterOptions {
  interactive?: boolean;
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): AgentAdapter {
  const interactive = options?.interactive ?? false;

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const baseArgs = [
        "--print",
        "--verbose",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ];

      const args = interactive
        ? [...baseArgs, "--input-format", "stream-json"]
        : [...baseArgs, prompt];

      const proc: ChildProcess = spawn("claude", args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
      });

      if (interactive) {
        const initMessage = JSON.stringify({
          type: "user",
          message: { role: "user", content: prompt },
        });
        proc.stdin?.write(`${initMessage}\n`);
      }

      async function* generateEvents(): AsyncGenerator<AgentEvent> {
        if (!proc.stdout) return;
        for await (const event of streamEvents(proc.stdout)) {
          yield event;
          if (event.type === "done" || event.type === "error") {
            proc.stdin?.end();
            proc.kill("SIGTERM");
            return;
          }
        }
      }

      return {
        events: generateEvents(),

        sendMessage(text: string): void {
          if (!interactive) return;
          const msg = JSON.stringify({
            type: "user",
            message: { role: "user", content: text },
          });
          proc.stdin?.write(`${msg}\n`);
        },

        abort(): void {
          proc.kill("SIGTERM");
        },
      };
    },
  };
}
