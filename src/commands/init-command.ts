import * as fs from "node:fs";
import * as path from "node:path";
import {
  RecipeError,
  createDefaultRecipeTemplate,
  getProjectRecipePath,
  validateRecipeName,
} from "../lib/recipes/index.js";
import { getProjectTemplatePath } from "../lib/storage-paths.js";
import { DEFAULT_TEMPLATE } from "../lib/template.js";
import type { LoopConfig } from "../lib/types.js";

export function runInitCommand(config: LoopConfig, write: (message: string) => void): boolean {
  if (config.command === "init") {
    const dest = getProjectTemplatePath(process.cwd());
    if (fs.existsSync(dest)) write(".loop/LOOP.md already exists. Skipping.");
    else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, DEFAULT_TEMPLATE, "utf-8");
      write("Created .loop/LOOP.md.");
    }
    return true;
  }
  if (config.command !== "init-recipe") return false;
  const name = config.initRecipeName;
  if (!name) throw new RecipeError("init-recipe requires a name. Usage: loop init-recipe <name>");
  validateRecipeName(name);
  const dest = getProjectRecipePath(name, process.cwd());
  if (fs.existsSync(dest)) write(`${path.relative(process.cwd(), dest)} already exists. Skipping.`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, createDefaultRecipeTemplate(name), "utf-8");
    write(`Created ${path.relative(process.cwd(), dest)}.`);
  }
  return true;
}
