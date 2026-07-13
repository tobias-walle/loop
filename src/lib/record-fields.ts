export function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" ? candidate : undefined;
}

export function nonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string,
): number | undefined {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}
