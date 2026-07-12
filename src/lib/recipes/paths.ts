import * as fs from "node:fs";
import * as path from "node:path";
import { getUserConfigPath } from "../config/paths.js";

export const RECIPE_EXTENSION = ".yaml";

export function getUserRecipesDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(getUserConfigPath(env)), "recipes");
}

export function getUserRecipePath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getUserRecipesDir(env), `${name}${RECIPE_EXTENSION}`);
}

export function findProjectRecipesDir(cwd: string = process.cwd()): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".loop", "recipes");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function getProjectRecipePath(name: string, cwd: string = process.cwd()): string {
  return path.join(path.resolve(cwd), ".loop", "recipes", `${name}${RECIPE_EXTENSION}`);
}

export function findProjectRecipePath(
  name: string,
  cwd: string = process.cwd(),
): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".loop", "recipes", `${name}${RECIPE_EXTENSION}`);
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
