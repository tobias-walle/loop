// Re-export from the claude module for backwards compatibility

export type { ClaudeAdapterOptions } from "./claude/adapter.js";
export { createClaudeAdapter } from "./claude/adapter.js";
export { parseClaudeLine } from "./claude/parsers.js";
export { readLines, streamEvents } from "./claude/stream.js";
