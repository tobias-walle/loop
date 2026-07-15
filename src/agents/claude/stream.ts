import type { Readable } from "node:stream";
import type { AgentEvent } from "../types.js";
import { readLines } from "../utils/lines.js";
import { parseClaudeLine } from "./parsers.js";
import type { BlockState } from "./types.js";

export { readLines };

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
