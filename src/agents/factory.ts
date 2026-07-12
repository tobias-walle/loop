import type { AgentName, LoopRuntimeConfig } from "../lib/config/index.js";
import type { Logger } from "../lib/logging.js";
import { createClaudeAdapter } from "./claude.js";
import { createPiAdapter } from "./pi.js";
import type { AgentAdapter } from "./types.js";

export type CreateConfiguredAgentOptions = {
  selectedAgent: AgentName;
  config: LoopRuntimeConfig;
  passthroughArgs?: string[];
  logger: Logger;
};

export function createConfiguredAgent(options: CreateConfiguredAgentOptions): AgentAdapter {
  const agentConfig = options.config.agents[options.selectedAgent];
  const common = {
    command: agentConfig.command,
    model: agentConfig.model,
    args: agentConfig.args,
    rawArgs: options.passthroughArgs ?? [],
    env: agentConfig.env,
    logger: options.logger,
  };

  if (options.selectedAgent === "pi") return createPiAdapter(common);
  return createClaudeAdapter(common);
}
