import * as fs from "node:fs";
import * as path from "node:path";
import {
  getProjectRecipePath as resolveProjectRecipePath,
  getProjectRecipesDir as resolveProjectRecipesDir,
  getUserRecipePath as resolveUserRecipePath,
  getUserRecipesDir as resolveUserRecipesDir,
} from "../storage-paths.js";

export { RECIPE_EXTENSION } from "../storage-paths.js";

export function getUserRecipesDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUserRecipesDir(env);
}

export function getUserRecipePath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolveUserRecipePath(name, env);
}

export function findProjectRecipesDir(cwd: string = process.cwd()): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = resolveProjectRecipesDir(current);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function getProjectRecipePath(name: string, cwd: string = process.cwd()): string {
  return resolveProjectRecipePath(name, cwd);
}

export function findProjectRecipePath(
  name: string,
  cwd: string = process.cwd(),
): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = resolveProjectRecipePath(name, current);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function findRecipePath(
  name: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    findProjectRecipePath(name, cwd) ??
    (fs.existsSync(getUserRecipePath(name, env)) ? getUserRecipePath(name, env) : undefined)
  );
}
