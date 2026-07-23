import * as fs from "node:fs";
import * as path from "node:path";
import { cyan, dim, green, yellow } from "../lib/ansi.js";
import { createDefaultConfigTemplate } from "../lib/config/template.js";
import {
  createDefaultRecipeTemplate,
  RecipeError,
  validateRecipeName,
} from "../lib/recipes/index.js";
import {
  getProjectConfigPath,
  getProjectRecipePath,
  getProjectTemplatePath,
  getUserConfigPath,
  getUserRecipePath,
} from "../lib/storage-paths.js";
import { DEFAULT_TEMPLATE } from "../lib/template.js";
import type { InitScope, LoopConfig } from "../lib/types.js";

const EXAMPLE_RECIPE_NAME = "example";

type InitTarget = {
  configPath: string;
  recipePath: (name: string) => string;
  displayPath: (destination: string) => string;
  templatePath?: string;
};

function resolveInitTarget(scope: InitScope): InitTarget {
  if (scope === "project") {
    const cwd = process.cwd();
    return {
      configPath: getProjectConfigPath(cwd),
      recipePath: (name) => getProjectRecipePath(name, cwd),
      displayPath: (destination) => path.relative(cwd, destination),
      templatePath: getProjectTemplatePath(cwd),
    };
  }
  return {
    configPath: getUserConfigPath(),
    recipePath: (name) => getUserRecipePath(name),
    displayPath: (destination) => destination,
  };
}

function createFile(
  target: InitTarget,
  destination: string,
  content: string,
  write: (message: string) => void,
): void {
  const displayPath = target.displayPath(destination);
  if (fs.existsSync(destination)) {
    write(`${yellow("○ Skipped")} ${dim(`${displayPath} (already exists)`)}`);
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, "utf-8");
  write(`${green("✓ Created")} ${cyan(displayPath)}`);
}

export function runInitCommand(config: LoopConfig, write: (message: string) => void): boolean {
  if (config.command !== "init" && config.command !== "init-recipe") return false;

  const target = resolveInitTarget(config.initScope ?? "user");
  if (config.command === "init") {
    createFile(target, target.configPath, createDefaultConfigTemplate(), write);
    createFile(
      target,
      target.recipePath(EXAMPLE_RECIPE_NAME),
      createDefaultRecipeTemplate(EXAMPLE_RECIPE_NAME),
      write,
    );
    if (config.includeTemplate) {
      if (!target.templatePath) throw new Error("--include-template requires project scope.");
      createFile(target, target.templatePath, DEFAULT_TEMPLATE, write);
    }
    return true;
  }

  const name = config.initRecipeName;
  if (!name) throw new RecipeError("init-recipe requires a name. Usage: loop init-recipe <name>");
  validateRecipeName(name);
  createFile(target, target.recipePath(name), createDefaultRecipeTemplate(name), write);
  return true;
}
