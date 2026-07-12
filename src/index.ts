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
export { createConfiguredAgent } from "./agents/factory.js";
export type { CreateConfiguredAgentOptions } from "./agents/factory.js";
export { createPiAdapter } from "./agents/pi.js";
export type { PiAdapterOptions } from "./agents/pi.js";
export {
  ConfigError,
  findProjectConfigPath,
  getUserConfigPath,
  loadLoopConfig,
  readConfigFile,
} from "./lib/config/index.js";
export type {
  AgentConfig,
  AgentName,
  ConfigCliOverrides,
  LoadedConfig,
  LoadConfigOptions,
  LoopConfigFile,
  LoopRuntimeConfig,
} from "./lib/config/index.js";
export { ParseError, formatHelp, parseArgs } from "./lib/parser.js";
export {
  RECIPE_EXTENSION,
  RecipeError,
  createDefaultRecipeTemplate,
  findProjectRecipePath,
  findProjectRecipesDir,
  findRecipePath,
  getProjectRecipePath,
  getUserRecipePath,
  getUserRecipesDir,
  loadRecipe,
  readRecipeFile,
  renderRecipeSteps,
  recipeAgentArgsSchema,
  recipeArgumentNameSchema,
  recipeArgumentSchema,
  recipeArgumentTypeSchema,
  recipeFileSchema,
  recipeGroupStepSchema,
  recipeNameSchema,
  recipeStepSchema,
  recipeTaskStepSchema,
  renderRecipeTemplate,
  resolveRecipeArguments,
  validateRecipeName,
} from "./lib/recipes/index.js";
export type {
  LoadedRecipe,
  LoadRecipeOptions,
  RecipeArgument,
  RecipeArgumentType,
  RecipeArgumentValue,
  RecipeArgumentValues,
  RecipeFile,
  RecipeStepFile,
} from "./lib/recipes/index.js";
export { createRunner } from "./lib/runner.js";
export type { RunnerOptions } from "./lib/runner.js";
export { DEFAULT_TEMPLATE, loadTemplate, renderTemplate } from "./lib/template.js";
export type {
  LoopConfig,
  PipelineState,
  RunResult,
  SessionResult,
  Step,
  StepExitReason,
  StepResult,
  TemplateContext,
} from "./lib/types.js";
export { createLoopTUI } from "./tui/loop-tui.js";
export type { LoopTUI, LoopTUIOptions } from "./tui/loop-tui.js";
export { isSandboxed } from "./lib/sandbox.js";
export { createSessionDir, getProjectSlug, updateSessionStatus } from "./lib/session.js";
export type { SessionMetadata, SessionStatus } from "./lib/session.js";
export { getUserConfigDir, getUserStateDir } from "./lib/storage-paths.js";
export { createLogger, noopLogger } from "./lib/logging.js";
export type { Logger } from "./lib/logging.js";
export { extractExitMarker } from "./lib/exit-marker.js";
