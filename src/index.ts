// Public API re-exports only — no logic, no side effects.

export type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  AgentSpawnOptions,
  TokenUsage,
} from "./agents/types.js";
export type { Scenario, ToolCall, Turn } from "./agents/stub.js";
export { createStubAdapter } from "./agents/stub.js";
export { createClaudeAdapter } from "./agents/claude.js";
export type { ClaudeAdapterOptions } from "./agents/claude.js";
export { ParseError, formatHelp, parseArgs } from "./lib/parser.js";
export { createRunner } from "./lib/runner.js";
export type { RunnerOptions } from "./lib/runner.js";
export { DEFAULT_TEMPLATE, loadTemplate, renderTemplate } from "./lib/template.js";
export type {
  LoopConfig,
  PipelineState,
  RunResult,
  Step,
  StepResult,
  TemplateContext,
} from "./lib/types.js";
export { createLoopTUI } from "./tui/loop-tui.js";
export type { LoopTUI, LoopTUIOptions } from "./tui/loop-tui.js";
export { isSandboxed } from "./lib/sandbox.js";
export { createSessionDir } from "./lib/session.js";
export { createLogger, noopLogger } from "./lib/logging.js";
export type { Logger } from "./lib/logging.js";
export { extractExitMarker } from "./lib/exit-marker.js";
