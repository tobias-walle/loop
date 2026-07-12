import * as fs from "node:fs";
import * as path from "node:path";
import { RecipeError } from "./errors.js";
import type { RecipeArgumentValues } from "./render.js";
import type { RecipeArgument, RecipeArgumentValue, RecipeFile } from "./schema.js";

export function resolveRecipeArguments(
  recipe: RecipeFile,
  rawArgs: string[],
  options: { cwd?: string } = {},
): RecipeArgumentValues {
  const cwd = options.cwd ?? process.cwd();
  const values: RecipeArgumentValues = {};
  const positionals: string[] = [];
  const lookup = createArgumentLookup(recipe.arguments);

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    if (token.startsWith("--") && token.length > 2) {
      const { flagName, inlineValue } = splitFlag(token);
      const argument = lookup.get(flagName);
      if (!argument) throw unknownArgumentError(flagName, recipe.arguments);
      if (Object.hasOwn(values, argument.name)) {
        throw new RecipeError(`Recipe argument "${argument.name}" was provided more than once.`);
      }

      let rawValue: string | boolean;
      if (argument.type === "boolean") {
        if (inlineValue !== undefined) {
          rawValue = inlineValue;
        } else if (rawArgs[i + 1] === "true" || rawArgs[i + 1] === "false") {
          rawValue = rawArgs[i + 1];
          i++;
        } else {
          rawValue = true;
        }
      } else if (inlineValue !== undefined) {
        rawValue = inlineValue;
      } else {
        const next = rawArgs[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new RecipeError(`Recipe argument "--${flagName}" requires a value.`);
        }
        rawValue = next;
        i++;
      }

      values[argument.name] = validateArgumentValue(argument, rawValue, cwd);
      continue;
    }

    positionals.push(token);
  }

  const positionalArguments = recipe.arguments.filter(
    (argument) => !Object.hasOwn(values, argument.name),
  );
  if (positionals.length > positionalArguments.length) {
    throw new RecipeError(
      `Too many positional recipe arguments. Expected at most ${positionalArguments.length}, got ${positionals.length}.`,
    );
  }

  positionals.forEach((rawValue, index) => {
    const argument = positionalArguments[index];
    values[argument.name] = validateArgumentValue(argument, rawValue, cwd);
  });

  for (const argument of recipe.arguments) {
    if (Object.hasOwn(values, argument.name)) continue;
    if (argument.default !== undefined) {
      values[argument.name] = validateArgumentValue(argument, argument.default, cwd);
      continue;
    }
    if (argument.required) {
      throw new RecipeError(
        `Missing required recipe argument "${argument.name}". Pass --${argument.name} <value> or provide it positionally.`,
      );
    }
  }

  return values;
}

function createArgumentLookup(arguments_: RecipeArgument[]): Map<string, RecipeArgument> {
  const lookup = new Map<string, RecipeArgument>();
  for (const argument of arguments_) {
    lookup.set(argument.name, argument);
    lookup.set(argument.name.replaceAll("_", "-"), argument);
  }
  return lookup;
}

function splitFlag(token: string): { flagName: string; inlineValue?: string } {
  const raw = token.slice(2);
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex === -1) return { flagName: raw };
  return { flagName: raw.slice(0, equalsIndex), inlineValue: raw.slice(equalsIndex + 1) };
}

function unknownArgumentError(flagName: string, arguments_: RecipeArgument[]): RecipeError {
  const known = arguments_.map((argument) => `--${argument.name}`).join(", ");
  return new RecipeError(
    `Unknown recipe argument "--${flagName}".${known ? ` Known arguments: ${known}.` : " This recipe has no arguments."}`,
  );
}

function validateArgumentValue(
  argument: RecipeArgument,
  rawValue: string | number | boolean,
  cwd: string,
): RecipeArgumentValue {
  const value = coerceArgumentValue(argument, rawValue, cwd);
  const valueText = String(value);

  if (argument.choices && !argument.choices.includes(valueText)) {
    throw new RecipeError(
      `Recipe argument "${argument.name}" must be one of: ${argument.choices.join(", ")}.`,
    );
  }

  if (argument.pattern && !new RegExp(argument.pattern).test(valueText)) {
    throw new RecipeError(
      `Recipe argument "${argument.name}" must match pattern ${argument.pattern}.`,
    );
  }

  return value;
}

function coerceArgumentValue(
  argument: RecipeArgument,
  rawValue: string | number | boolean,
  cwd: string,
): RecipeArgumentValue {
  switch (argument.type) {
    case "string":
      if (typeof rawValue !== "string") throw expectedTypeError(argument, "string");
      return rawValue;
    case "path":
      if (typeof rawValue !== "string") throw expectedTypeError(argument, "path");
      assertValidPath(argument.name, rawValue);
      return rawValue;
    case "file":
      if (typeof rawValue !== "string") throw expectedTypeError(argument, "file path");
      assertValidPath(argument.name, rawValue);
      assertPathKind(argument.name, rawValue, cwd, "file");
      return rawValue;
    case "directory":
      if (typeof rawValue !== "string") throw expectedTypeError(argument, "directory path");
      assertValidPath(argument.name, rawValue);
      assertPathKind(argument.name, rawValue, cwd, "directory");
      return rawValue;
    case "integer":
      return coerceInteger(argument.name, rawValue);
    case "number":
      return coerceNumber(argument.name, rawValue);
    case "boolean":
      return coerceBoolean(argument.name, rawValue);
  }
}

function expectedTypeError(argument: RecipeArgument, expected: string): RecipeError {
  return new RecipeError(`Recipe argument "${argument.name}" must be a ${expected}.`);
}

function assertValidPath(name: string, value: string): void {
  if (value.length === 0 || value.includes("\0")) {
    throw new RecipeError(`Recipe argument "${name}" must be a valid path.`);
  }
}

function assertPathKind(
  name: string,
  value: string,
  cwd: string,
  expected: "file" | "directory",
): void {
  let stat: fs.Stats;
  const absolutePath = path.resolve(cwd, value);
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    throw new RecipeError(
      `Recipe argument "${name}" must point to an existing ${expected}: ${value}`,
    );
  }

  const matches = expected === "file" ? stat.isFile() : stat.isDirectory();
  if (!matches) {
    throw new RecipeError(`Recipe argument "${name}" must point to a ${expected}: ${value}`);
  }
}

function coerceInteger(name: string, rawValue: string | number | boolean): number {
  if (typeof rawValue === "number") {
    if (Number.isInteger(rawValue)) return rawValue;
    throw new RecipeError(`Recipe argument "${name}" must be an integer.`);
  }
  if (typeof rawValue !== "string" || !/^-?\d+$/.test(rawValue)) {
    throw new RecipeError(`Recipe argument "${name}" must be an integer.`);
  }
  return Number(rawValue);
}

function coerceNumber(name: string, rawValue: string | number | boolean): number {
  if (typeof rawValue === "number") {
    if (Number.isFinite(rawValue)) return rawValue;
    throw new RecipeError(`Recipe argument "${name}" must be a number.`);
  }
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new RecipeError(`Recipe argument "${name}" must be a number.`);
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new RecipeError(`Recipe argument "${name}" must be a number.`);
  }
  return value;
}

function coerceBoolean(name: string, rawValue: string | number | boolean): boolean {
  if (typeof rawValue === "boolean") return rawValue;
  if (typeof rawValue !== "string") {
    throw new RecipeError(`Recipe argument "${name}" must be true or false.`);
  }
  const normalized = rawValue.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new RecipeError(`Recipe argument "${name}" must be true or false.`);
}
