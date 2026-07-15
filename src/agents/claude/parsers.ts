import type { AgentEvent } from "../types.js";
import type { BlockState, ClaudeEvent } from "./types.js";

/**
 * Parse a single NDJSON line from Claude and translate it into AgentEvents.
 * Returns an array because one line can produce zero or more events.
 */
export function parseClaudeLine(
  line: string,
  blocksByIndex: Map<number, BlockState>,
  parentToolUseIdByIndex: Map<number, string | null>,
  toolIdToParent: Map<string, string | null>,
  taskModelByToolUseId?: Map<string, string>,
): AgentEvent[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line.trim() ? [{ type: "error", message: "Claude emitted malformed JSON" }] : [];
  }

  if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
    return [];
  }

  const typed = parsed as unknown as ClaudeEvent;

  switch (typed.type) {
    case "system":
      return parseSystemEvent(typed, parsed, taskModelByToolUseId);
    case "stream_event":
      return parseStreamEvent(typed, parsed, blocksByIndex, parentToolUseIdByIndex, toolIdToParent);
    case "user":
      return parseUserEvent(typed, toolIdToParent);
    case "rate_limit_event":
      return [
        {
          type: "rate_limit",
          status: typed.rate_limit_info.status,
          resetsAt: typed.rate_limit_info.resetsAt,
        },
      ];
    case "result":
      return parseResultEvent(typed);
    case "assistant":
      return parseAssistantEvent(typed, toolIdToParent, taskModelByToolUseId);
    default:
      return [{ type: "unknown", eventType: parsed.type as string, raw: parsed }];
  }
}

function parseSystemEvent(
  typed: Extract<ClaudeEvent, { type: "system" }>,
  raw: Record<string, unknown>,
  taskModelByToolUseId?: Map<string, string>,
): AgentEvent[] {
  switch (typed.subtype) {
    case "init":
      return [
        {
          type: "session_start",
          model: typed.model,
          sessionId: typed.session_id,
          tools: typed.tools,
        },
      ];
    case "api_retry":
      return [
        {
          type: "retry",
          attempt: typed.attempt,
          maxRetries: typed.max_retries,
          delayMs: typed.retry_delay_ms,
          error: typed.error,
        },
      ];
    case "task_started":
      return [
        {
          type: "task_started",
          taskId: typed.task_id,
          toolUseId: typed.tool_use_id,
          description: typed.description,
          prompt: typed.prompt,
        },
      ];
    case "task_notification":
      return [
        {
          type: "task_done",
          taskId: typed.task_id,
          toolUseId: typed.tool_use_id,
          status: typed.status,
          summary: typed.summary,
          durationMs: typed.usage.duration_ms,
          model: taskModelByToolUseId?.get(typed.tool_use_id),
          totalTokens: typed.usage.total_tokens,
        },
      ];
    case "task_progress":
      return [];
    default:
      return [
        {
          type: "unknown",
          eventType: `system/${String(raw.subtype)}`,
          raw,
        },
      ];
  }
}

function parseStreamEvent(
  typed: Extract<ClaudeEvent, { type: "stream_event" }>,
  raw: Record<string, unknown>,
  blocksByIndex: Map<number, BlockState>,
  parentToolUseIdByIndex: Map<number, string | null>,
  toolIdToParent: Map<string, string | null>,
): AgentEvent[] {
  const parentToolUseId = typed.parent_tool_use_id ?? null;
  const evt = typed.event;
  const events: AgentEvent[] = [];

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
        events.push({ type: "text_done", text: block.text, parentToolUseId: pId });
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

    case "message_start":
    case "message_delta":
    case "message_stop":
      break;

    default:
      events.push({
        type: "unknown",
        eventType: `stream_event/${String((evt as { type: string }).type)}`,
        raw,
      });
      break;
  }

  return events;
}

function parseUserEvent(
  typed: Extract<ClaudeEvent, { type: "user" }>,
  toolIdToParent: Map<string, string | null>,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  const content = typed.message?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "tool_result") {
        const parentId = toolIdToParent.get(item.tool_use_id) ?? null;
        events.push({
          type: "tool_done",
          toolId: item.tool_use_id,
          result: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
          parentToolUseId: parentId,
        });
      }
    }
  }
  return events;
}

function parseResultEvent(typed: Extract<ClaudeEvent, { type: "result" }>): AgentEvent[] {
  if (typed.is_error) {
    return [{ type: "error", message: typed.result }];
  }
  return [
    {
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
    },
  ];
}

function parseAssistantEvent(
  typed: Extract<ClaudeEvent, { type: "assistant" }>,
  toolIdToParent: Map<string, string | null>,
  taskModelByToolUseId?: Map<string, string>,
): AgentEvent[] {
  const parentId = typed.parent_tool_use_id ?? null;
  if (parentId === null) return [];

  // Track subagent model from the first assistant event
  if (typed.message.model && taskModelByToolUseId && !taskModelByToolUseId.has(parentId)) {
    taskModelByToolUseId.set(parentId, typed.message.model);
  }

  const events: AgentEvent[] = [];
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
  return events;
}
