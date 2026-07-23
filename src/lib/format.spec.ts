import { describe, expect, test } from "bun:test";
import { formatDuration, formatTokenCount, formatTokens } from "./format.js";

describe("neutral formatting", () => {
  test("formats durations and token totals", () => {
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatTokenCount(1_250)).toBe("1.3k");
    expect(formatTokens({ inputTokens: 2, outputTokens: 3 })).toBe("5 tokens");
  });
});
