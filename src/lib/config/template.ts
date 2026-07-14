import { DEFAULT_RUNTIME_CONFIG } from "./schema.js";

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function createDefaultConfigTemplate(): string {
  const defaults = DEFAULT_RUNTIME_CONFIG;
  return `# Loop configuration
# Uncomment values to override Loop's defaults.

# agent = ${tomlString(defaults.agent)}

# [agents.claude]
# command = ${tomlString(defaults.agents.claude.command ?? "")}
# env = {}

# [agents.claude.args]
# permission-mode = ${tomlString(String(defaults.agents.claude.args["permission-mode"]))}

# [agents.pi]
# command = ${tomlString(defaults.agents.pi.command ?? "")}
# args = {}
# env = {}
`;
}
