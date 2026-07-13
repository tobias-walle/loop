import { ConfigError, type LoopRuntimeConfig, loadLoopConfig } from "../lib/config/index.js";
import { RecipeError, loadRecipe } from "../lib/recipes/index.js";
import { loadTemplate } from "../lib/template.js";
import type { LoopConfig } from "../lib/types.js";
import { executeSession } from "./execute-session.js";

export interface RunCommandIO {
  writeError(message: string): void;
}

export async function runCommand(initialConfig: LoopConfig, io: RunCommandIO): Promise<number> {
  let config = initialConfig;
  let loadedRecipe: ReturnType<typeof loadRecipe> | undefined;

  if (config.recipe) {
    try {
      loadedRecipe = loadRecipe(config.recipe.name, config.recipe.args);
      config = { ...config, steps: loadedRecipe.steps };
    } catch (error) {
      if (error instanceof RecipeError) {
        io.writeError(`Error: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  if (config.steps.length === 0) {
    io.writeError('Error: No tasks provided. Usage: loop "task" or loop --recipe <name>');
    return 1;
  }

  let runtimeConfig: LoopRuntimeConfig;
  try {
    runtimeConfig = loadLoopConfig({ cli: { agent: config.agent } }).config;
  } catch (error) {
    if (error instanceof ConfigError) {
      io.writeError(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const projectRoot = process.cwd();
  return executeSession({
    config,
    runtimeConfig,
    template: loadTemplate(projectRoot),
    loadedRecipe,
    projectRoot,
  });
}
