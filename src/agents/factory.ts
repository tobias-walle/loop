import type { AgentName, LoopRuntimeConfig } from "../lib/config/index.js";
import type { Logger } from "../lib/logging.js";
import { createClaudeAdapter } from "./claude.js";
import { createPiRpcAdapter } from "./pi.js";
import type { AgentAdapter } from "./types.js";

export type CreateConfiguredAgentOptions = {
  selectedAgent: AgentName;
  config: LoopRuntimeConfig;
  passthroughArgs?: string[];
  logger: Logger;
};

export function createConfiguredAgent(options: CreateConfiguredAgentOptions): AgentAdapter {
  const agentConfig = options.config.agents[options.selectedAgent];
  const args = [...agentConfig.args, ...(options.passthroughArgs ?? [])];
  const common = {
    command: agentConfig.command,
    model: agentConfig.model,
    args,
    env: agentConfig.env,
    logger: options.logger,
  };

  if (options.selectedAgent === "pi") return createPiRpcAdapter(common);
  return createClaudeAdapter({ ...common, interactive: true });
}
