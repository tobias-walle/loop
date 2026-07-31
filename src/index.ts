// Public API re-exports only — no logic, no side effects.

export type { ClaudeAdapterOptions } from "./agents/claude.js";
export { createClaudeAdapter } from "./agents/claude.js";
export type { CreateConfiguredAgentOptions } from "./agents/factory.js";
export { createConfiguredAgent } from "./agents/factory.js";
export type { PiAdapterOptions } from "./agents/pi.js";
export { createPiAdapter } from "./agents/pi.js";
export type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  AgentSpawnOptions,
  TokenUsage,
} from "./agents/types.js";
export { CliError, createCliCommand, formatHelp, parseCliArgs } from "./lib/cli-command.js";
export type {
  AgentConfig,
  AgentName,
  ConfigCliOverrides,
  LoadConfigOptions,
  LoadedConfig,
  LoopConfigFile,
  LoopRuntimeConfig,
} from "./lib/config/index.js";
export {
  ConfigError,
  findProjectConfigPath,
  getUserConfigPath,
  loadLoopConfig,
  readConfigFile,
} from "./lib/config/index.js";
export { extractExitMarker } from "./lib/exit-marker.js";
export type { Logger } from "./lib/logging.js";
export { createLogger, noopLogger } from "./lib/logging.js";
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
export {
  createDefaultRecipeTemplate,
  findProjectRecipePath,
  findProjectRecipesDir,
  findRecipePath,
  getProjectRecipePath,
  getUserRecipePath,
  getUserRecipesDir,
  loadRecipe,
  RECIPE_EXTENSION,
  RecipeError,
  readRecipeFile,
  recipeAgentArgsSchema,
  recipeArgumentNameSchema,
  recipeArgumentSchema,
  recipeArgumentTypeSchema,
  recipeFileSchema,
  recipeGroupStepSchema,
  recipeNameSchema,
  recipeStepSchema,
  recipeTaskStepSchema,
  renderRecipeSteps,
  renderRecipeTemplate,
  resolveRecipeArguments,
  validateRecipeName,
} from "./lib/recipes/index.js";
export type { RunnerOptions } from "./lib/runner.js";
export { createRunner } from "./lib/runner.js";
export { isSandboxed } from "./lib/sandbox.js";
export type { SessionMetadata, SessionStatus } from "./lib/session.js";
export { createSessionDir, getProjectSlug, updateSessionStatus } from "./lib/session.js";
export { getUserConfigDir, getUserStateDir } from "./lib/storage-paths.js";
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
export type {
  ClaudeScenarioBuilder,
  ClaudeUsage,
} from "./testing/claude-scenario.js";
export { createClaudeScenario } from "./testing/claude-scenario.js";
export type {
  FakeProcessOperation,
  FakeProcessRun,
  FakeProcessSpawner,
  FakeProcessState,
} from "./testing/fake-process.js";
export { createFakeProcessSpawner } from "./testing/fake-process.js";
export type {
  AgentScenario,
  HarnessRunOptions,
  HarnessRunResult,
  LoopTestHarness,
  LoopTestRoots,
  ProviderHarness,
} from "./testing/loop-test-harness.js";
export { setupLoopTest } from "./testing/loop-test-harness.js";
export type { PiScenarioBuilder, PiUsage } from "./testing/pi-scenario.js";
export { createPiScenario } from "./testing/pi-scenario.js";
