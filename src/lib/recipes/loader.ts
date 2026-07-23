import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import type { Step } from "../types.js";
import { resolveRecipeArguments } from "./arguments.js";
import { formatRecipeZodError, RecipeError } from "./errors.js";
import { findRecipePath, getUserRecipePath } from "./paths.js";
import { type RecipeArgumentValues, renderRecipeSteps } from "./render.js";
import { type RecipeFile, recipeFileSchema, recipeNameSchema } from "./schema.js";

export type LoadRecipeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type LoadedRecipe = {
  name: string;
  path: string;
  recipe: RecipeFile;
  values: RecipeArgumentValues;
  steps: Step[];
};

export function loadRecipe(
  name: string,
  rawArgs: string[],
  options: LoadRecipeOptions = {},
): LoadedRecipe {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  validateRecipeName(name);

  const recipePath = findRecipePath(name, cwd, env);
  if (!recipePath) {
    throw new RecipeError(
      `Recipe "${name}" not found. Looked for project .loop/recipes/${name}.yaml walking upward from ${path.resolve(cwd)} and user recipe ${getUserRecipePath(name, env)}.`,
    );
  }

  const recipe = readRecipeFile(recipePath);
  const values = resolveRecipeArguments(recipe, rawArgs, { cwd });
  return {
    name,
    path: recipePath,
    recipe,
    values,
    steps: renderRecipeSteps(recipe, values),
  };
}

export function readRecipeFile(filePath: string): RecipeFile {
  let parsed: unknown;
  try {
    parsed = parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    if (err instanceof Error) {
      throw new RecipeError(`Invalid Loop recipe: ${filePath}\n\n${err.message}`);
    }
    throw err;
  }

  const result = recipeFileSchema.safeParse(parsed);
  if (!result.success) throw formatRecipeZodError(filePath, result.error);
  return result.data;
}

export function validateRecipeName(name: string): void {
  const result = recipeNameSchema.safeParse(name);
  if (result.success) return;
  throw new RecipeError(
    `Invalid recipe name "${name}": ${result.error.issues[0]?.message ?? "invalid"}`,
  );
}
