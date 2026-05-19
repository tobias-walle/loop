import type { AgentName, ConfigCliOverrides, LoopConfigFile, LoopRuntimeConfig } from "./schema.js";
import { DEFAULT_RUNTIME_CONFIG } from "./schema.js";

function cloneDefaults(): LoopRuntimeConfig {
  return {
    agent: DEFAULT_RUNTIME_CONFIG.agent,
    agents: {
      claude: { ...DEFAULT_RUNTIME_CONFIG.agents.claude, args: [], env: {} },
      pi: { ...DEFAULT_RUNTIME_CONFIG.agents.pi, args: [], env: {} },
    },
  };
}

export function mergeConfigFiles(files: LoopConfigFile[]): LoopRuntimeConfig {
  const config = cloneDefaults();
  for (const file of files) mergeFile(config, file);
  return config;
}

export function mergeFile(config: LoopRuntimeConfig, file: LoopConfigFile): void {
  if (file.agent) config.agent = file.agent;
  for (const name of ["claude", "pi"] as const) {
    const agent = file.agents?.[name];
    if (!agent) continue;
    config.agents[name] = {
      ...config.agents[name],
      ...agent,
      args: agent.args ?? config.agents[name].args,
      env: agent.env ? { ...config.agents[name].env, ...agent.env } : config.agents[name].env,
    };
  }
}

export function applyEnvOverrides(
  config: LoopRuntimeConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.LOOP_AGENT) config.agent = env.LOOP_AGENT as AgentName;
  if (env.LOOP_PI_COMMAND) config.agents.pi.command = env.LOOP_PI_COMMAND;
  if (env.LOOP_PI_MODEL) config.agents.pi.model = env.LOOP_PI_MODEL;
  if (env.LOOP_CLAUDE_COMMAND) config.agents.claude.command = env.LOOP_CLAUDE_COMMAND;
  if (env.LOOP_CLAUDE_MODEL) config.agents.claude.model = env.LOOP_CLAUDE_MODEL;
}

export function applyCliOverrides(config: LoopRuntimeConfig, cli?: ConfigCliOverrides): void {
  if (cli?.agent) config.agent = cli.agent;
}
