import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function getUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOOP_CONFIG_HOME) return path.join(env.LOOP_CONFIG_HOME, "config.toml");
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "loop", "config.toml");
  return path.join(os.homedir(), ".config", "loop", "config.toml");
}

export function findProjectConfigPath(cwd: string = process.cwd()): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".loop", "config.toml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
