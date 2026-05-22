export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordAt(value: unknown, path: string[]): Record<string, unknown> | undefined {
  const found = getAt(value, path);
  return isRecord(found) ? found : undefined;
}

export function stringAt(value: unknown, path: string[]): string | undefined {
  const found = getAt(value, path);
  return typeof found === "string" ? found : undefined;
}

export function numberAt(value: unknown, path: string[]): number | undefined {
  const found = getAt(value, path);
  return typeof found === "number" ? found : undefined;
}

export function getAt(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
