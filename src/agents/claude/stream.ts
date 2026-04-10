import type { Readable } from "node:stream";
import type { AgentEvent } from "../types.js";
import { parseClaudeLine } from "./parsers.js";
import type { BlockState } from "./types.js";

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

  // Also handle 'close' — destroy() emits 'close' but not 'end',
  // so we need this to unblock when the process force-closes stdout.
  const onClose = () => {
    if (!streamEnded) onEnd();
  };

  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);
  stream.on("close", onClose);

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
    stream.off("close", onClose);
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
  const taskModelByToolUseId = new Map<string, string>();

  for await (const line of readLines(stdout)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const events = parseClaudeLine(
      trimmed,
      blocksByIndex,
      parentToolUseIdByIndex,
      toolIdToParent,
      taskModelByToolUseId,
    );
    for (const event of events) {
      yield event;
      if (event.type === "done" || event.type === "error") {
        return;
      }
    }
  }
}

/**
 * Async generator for interactive mode. Reads NDJSON lines and yields
 * parsed AgentEvents. Detects user messages and emits user_message events.
 */
export async function* generateInteractiveEvents(
  stdout: Readable,
  sentMessages: string[],
): AsyncGenerator<AgentEvent> {
  const blocksByIndex = new Map<number, BlockState>();
  const parentToolUseIdByIndex = new Map<number, string | null>();
  const toolIdToParent = new Map<string, string | null>();
  const taskModelByToolUseId = new Map<string, string>();

  for await (const line of readLines(stdout)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect top-level message_start → Claude is processing our input.
    // Emit user_message events so the TUI renders them at the right spot.
    if (sentMessages.length > 0) {
      try {
        const raw = JSON.parse(trimmed);
        if (
          raw.type === "stream_event" &&
          raw.event?.type === "message_start" &&
          raw.parent_tool_use_id == null
        ) {
          for (const text of sentMessages) {
            yield { type: "user_message", text };
          }
          sentMessages.length = 0;
        }
      } catch {
        // Ignore parse errors during detection
      }
    }

    const events = parseClaudeLine(
      trimmed,
      blocksByIndex,
      parentToolUseIdByIndex,
      toolIdToParent,
      taskModelByToolUseId,
    );
    for (const event of events) {
      // If session would end but we have unprocessed input, keep it alive
      if (event.type === "done" && sentMessages.length > 0) {
        continue;
      }
      yield event;
      if (event.type === "done" || event.type === "error") {
        return;
      }
    }
  }
}
