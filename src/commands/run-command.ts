import { ConfigError, type LoopRuntimeConfig, loadLoopConfig } from "../lib/config/index.js";
import { loadRecipe, RecipeError } from "../lib/recipes/index.js";
import { loadTemplate } from "../lib/template.js";
import type { LoopConfig } from "../lib/types.js";
import type { RunOutput } from "../output/run-reporter.js";
import { executeSession } from "./execute-session.js";
import { createRunReporter } from "./run-reporter.js";

export interface RunCommandIO {
  stdout: RunOutput;
  signal?: AbortSignal;
  writeError(message: string): void;
}

type RunCommandDependencies = {
  createRunReporter: typeof createRunReporter;
  executeSession: typeof executeSession;
};

const defaultDependencies: RunCommandDependencies = { createRunReporter, executeSession };

export async function runCommand(
  initialConfig: LoopConfig,
  io: RunCommandIO,
  dependencies: RunCommandDependencies = defaultDependencies,
): Promise<number> {
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
  await using reporter = dependencies.createRunReporter(io.stdout);
  return await dependencies.executeSession({
    config,
    runtimeConfig,
    template: loadTemplate(projectRoot),
    loadedRecipe,
    projectRoot,
    reporter,
    signal: io.signal,
  });
}
