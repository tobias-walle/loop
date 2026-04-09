// Re-export from the claude module for backwards compatibility
export { parseClaudeLine } from "./claude/parsers.js";
export { readLines, streamEvents } from "./claude/stream.js";
export { createClaudeAdapter } from "./claude/adapter.js";
export type { ClaudeAdapterOptions } from "./claude/adapter.js";
