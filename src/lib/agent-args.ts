export type AgentArgValue = string | boolean;
export type AgentArgs = Record<string, AgentArgValue>;

export function renderAgentArgs(args: AgentArgs = {}): string[] {
  const rendered: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    if (value === false) continue;
    const flag = `--${name}`;
    if (value === true) {
      rendered.push(flag);
    } else {
      rendered.push(flag, value);
    }
  }
  return rendered;
}

export function mergeAgentArgs(...args: Array<AgentArgs | undefined>): AgentArgs {
  return Object.assign({}, ...args);
}
