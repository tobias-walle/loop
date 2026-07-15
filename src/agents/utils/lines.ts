import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export async function* readLines(input: Readable): AsyncGenerator<string> {
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const close = () => lines.close();
  input.once("close", close);
  try {
    for await (const line of lines) yield line;
  } catch {
    // Process streams can be destroyed when their process exits.
  } finally {
    input.off("close", close);
    lines.close();
  }
}
