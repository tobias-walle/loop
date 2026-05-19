import type { ZodError } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function formatZodError(path: string, error: ZodError): ConfigError {
  const lines = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${field}: ${issue.message}`;
  });
  return new ConfigError(`Invalid Loop config: ${path}\n\n${lines.join("\n")}`);
}
