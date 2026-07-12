import type { AgentArgs } from "../agent-args.js";
import type { Step } from "../types.js";
import type { RecipeArgumentValue, RecipeFile } from "./schema.js";

export type RecipeArgumentValues = Record<string, RecipeArgumentValue>;

export function renderRecipeSteps(recipe: RecipeFile, values: RecipeArgumentValues): Step[] {
  return recipe.steps.map((step) => {
    const modifiers = {
      ...(step.until !== undefined ? { until: renderRecipeTemplate(step.until, values) } : {}),
      ...(step.repeat !== undefined ? { repeat: step.repeat } : {}),
      ...(step.max !== undefined ? { max: step.max } : {}),
      ...(step.args !== undefined ? { args: renderRecipeAgentArgs(step.args, values) } : {}),
    };

    if ("task" in step) {
      return { type: "task", task: renderRecipeTemplate(step.task, values), ...modifiers };
    }

    return {
      type: "group",
      tasks: step.tasks.map((task) => renderRecipeTemplate(task, values)),
      ...modifiers,
    };
  });
}

export function renderRecipeTemplate(input: string, values: RecipeArgumentValues): string {
  const lookup = createLookup(values);

  return input
    .replace(
      /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (full, key: string) => lookup.get(key) ?? full,
    )
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (full, key: string) => lookup.get(key) ?? full)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (full, key: string) => lookup.get(key) ?? full);
}

function renderRecipeAgentArgs(args: AgentArgs, values: RecipeArgumentValues): AgentArgs {
  const rendered: AgentArgs = {};
  for (const [name, value] of Object.entries(args)) {
    rendered[name] = typeof value === "string" ? renderRecipeTemplate(value, values) : value;
  }
  return rendered;
}

function createLookup(values: RecipeArgumentValues): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [name, value] of Object.entries(values)) {
    const rendered = String(value);
    lookup.set(name, rendered);
    lookup.set(name.toUpperCase(), rendered);
  }
  return lookup;
}
