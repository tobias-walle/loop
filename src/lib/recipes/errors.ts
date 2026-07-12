import type { ZodError } from "zod";

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeError";
  }
}

export function formatRecipeZodError(path: string, error: ZodError): RecipeError {
  const lines = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${field}: ${issue.message}`;
  });
  return new RecipeError(`Invalid Loop recipe: ${path}\n\n${lines.join("\n")}`);
}
