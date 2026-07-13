import type { LoopRuntimeConfig } from "../lib/config/index.js";
import type { createLogger } from "../lib/logging.js";
import type { loadRecipe } from "../lib/recipes/index.js";
import type { createRunner } from "../lib/runner.js";
import type { LoopConfig } from "../lib/types.js";
import type { createLoopTUI } from "../tui/loop-tui.js";

export function updateSessionDisplay(
  tui: ReturnType<typeof createLoopTUI> | undefined,
  runner: ReturnType<typeof createRunner> | undefined,
  stepIndex: number,
  totalSteps: number,
  iteration?: number,
  max?: number,
): void {
  if (!(tui && runner)) return;
  const state = runner.getState();
  tui.updateStatus({
    step: stepIndex + 1,
    totalSteps,
    iteration,
    max,
    costUsd: state.costUsd,
    currentSessionCostUsd: state.currentSessionCostUsd,
    usage: state.usage,
    currentSessionUsage: state.currentSessionUsage,
  });
}

export function logSessionSetup(
  logger: ReturnType<typeof createLogger>,
  sessionDir: string,
  config: LoopConfig,
  runtimeConfig: LoopRuntimeConfig,
  loadedRecipe: ReturnType<typeof loadRecipe> | undefined,
): void {
  logger.info("Session initialized", { source: "loop", type: "session_init", sessionDir });
  if (loadedRecipe) {
    logger.info("Recipe loaded", {
      source: "loop",
      type: "recipe_loaded",
      recipeName: loadedRecipe.name,
      recipePath: loadedRecipe.path,
      argumentNames: Object.keys(loadedRecipe.values),
    });
  }
  logger.info("Config parsed", {
    source: "loop",
    type: "config_parsed",
    stepCount: config.steps.length,
    commandType: config.command,
    recipeName: config.recipe?.name,
    agent: runtimeConfig.agent,
    passthroughArgCount: config.passthroughArgs?.length ?? 0,
  });
  logger.debug("Agent adapter created", {
    source: "loop",
    type: "adapter_created",
    agent: runtimeConfig.agent,
  });
}
