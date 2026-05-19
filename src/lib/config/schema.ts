import { z } from "zod";

export const agentNameSchema = z.enum(["claude", "pi"]);
export type AgentName = z.infer<typeof agentNameSchema>;

export const agentConfigSchema = z
  .object({
    command: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const fileConfigSchema = z
  .object({
    agent: agentNameSchema.optional(),
    agents: z
      .object({
        claude: agentConfigSchema.optional(),
        pi: agentConfigSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type LoopConfigFile = z.infer<typeof fileConfigSchema>;

export type AgentConfig = {
  command?: string;
  model?: string;
  args: string[];
  env: Record<string, string>;
};

export type LoopRuntimeConfig = {
  agent: AgentName;
  agents: Record<AgentName, AgentConfig>;
};

export type ConfigCliOverrides = {
  agent?: AgentName;
};

export const DEFAULT_RUNTIME_CONFIG: LoopRuntimeConfig = {
  agent: "claude",
  agents: {
    claude: { command: "claude", args: [], env: {} },
    pi: { command: "pi", args: [], env: {} },
  },
};
