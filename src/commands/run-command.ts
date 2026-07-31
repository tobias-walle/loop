import type { SpawnChildProcess } from "../agents/utils/child-process.js";
import { ConfigError, type LoopRuntimeConfig, loadLoopConfig } from "../lib/config/index.js";
import { loadRecipe, RecipeError } from "../lib/recipes/index.js";
import { loadTemplate } from "../lib/template.js";
import type { LoopConfig } from "../lib/types.js";
import type { RunOutput } from "../output/run-reporter.js";
import type { executeSession } from "./execute-session.js";
import type { createRunReporter } from "./run-reporter.js";

export interface RunCommandIO {
  stdout: RunOutput;
  signal?: AbortSignal;
  writeError(message: string): void;
}

export type RunCommandDependencies = {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  spawnProcess: SpawnChildProcess;
  createRunReporter: typeof createRunReporter;
  executeSession: typeof executeSession;
};

export async function runCommand(
  initialConfig: LoopConfig,
  io: RunCommandIO,
  dependencies: RunCommandDependencies,
): Promise<number> {
  let config = initialConfig;
  let loadedRecipe: ReturnType<typeof loadRecipe> | undefined;

  if (config.recipe) {
    try {
      loadedRecipe = loadRecipe(config.recipe.name, config.recipe.args, {
        cwd: dependencies.projectRoot,
        env: dependencies.env,
      });
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
    runtimeConfig = loadLoopConfig({
      cwd: dependencies.projectRoot,
      env: dependencies.env,
      cli: { agent: config.agent },
    }).config;
  } catch (error) {
    if (error instanceof ConfigError) {
      io.writeError(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  await using reporter = dependencies.createRunReporter(io.stdout);
  return await dependencies.executeSession(
    {
      config,
      runtimeConfig,
      template: loadTemplate(dependencies.projectRoot),
      loadedRecipe,
      projectRoot: dependencies.projectRoot,
      reporter,
      signal: io.signal,
    },
    { env: dependencies.env, spawnProcess: dependencies.spawnProcess },
  );
}
