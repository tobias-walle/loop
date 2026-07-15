import type { Readable } from "node:stream";
import { readLines } from "../utils/lines.js";

export async function* readJsonLines(stream: Readable): AsyncGenerator<unknown> {
  for await (const line of readLines(stream)) {
    const trimmed = line.trim();
    if (trimmed) yield JSON.parse(trimmed);
  }
}
