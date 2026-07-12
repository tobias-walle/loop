import * as fs from "node:fs";
import * as path from "node:path";
import {
  getProjectConfigPath,
  getUserConfigPath as resolveUserConfigPath,
} from "../storage-paths.js";

export function getUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUserConfigPath(env);
}

export function findProjectConfigPath(cwd: string = process.cwd()): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = getProjectConfigPath(current);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
