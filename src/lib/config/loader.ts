import * as fs from "node:fs";
import { TomlError, parse } from "smol-toml";
import { ConfigError, formatZodError } from "./errors.js";
import { applyCliOverrides, applyEnvOverrides, mergeConfigFiles } from "./merge.js";
import { findProjectConfigPath, getUserConfigPath } from "./paths.js";
import {
  type ConfigCliOverrides,
  type LoopConfigFile,
  type LoopRuntimeConfig,
  agentNameSchema,
  fileConfigSchema,
} from "./schema.js";

export type LoadConfigOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cli?: ConfigCliOverrides;
};

export type LoadedConfig = {
  config: LoopRuntimeConfig;
  paths: {
    user?: string;
    project?: string;
  };
};

export function loadLoopConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const userPath = getUserConfigPath(env);
  const projectPath = findProjectConfigPath(cwd);
  const files: LoopConfigFile[] = [];
  const paths: LoadedConfig["paths"] = {};

  if (fs.existsSync(userPath)) {
    files.push(readConfigFile(userPath));
    paths.user = userPath;
  }
  if (projectPath) {
    files.push(readConfigFile(projectPath));
    paths.project = projectPath;
  }

  const config = mergeConfigFiles(files);
  applyEnvOverrides(config, env);
  validateRuntimeAgent(config.agent, "LOOP_AGENT");
  applyCliOverrides(config, options.cli);
  validateRuntimeAgent(config.agent, "--agent");

  return { config, paths };
}

export function readConfigFile(path: string): LoopConfigFile {
  let parsed: unknown;
  try {
    parsed = parse(fs.readFileSync(path, "utf-8"));
  } catch (err) {
    if (err instanceof TomlError || err instanceof Error) {
      throw new ConfigError(`Invalid Loop config: ${path}\n\n${err.message}`);
    }
    throw err;
  }

  const result = fileConfigSchema.safeParse(parsed);
  if (!result.success) throw formatZodError(path, result.error);
  return result.data;
}

function validateRuntimeAgent(agent: string, source: string): void {
  const result = agentNameSchema.safeParse(agent);
  if (!result.success) {
    throw new ConfigError(`${source}: expected agent to be "claude" or "pi", got "${agent}"`);
  }
}
