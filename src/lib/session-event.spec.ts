import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createEvent, isStep, isStepResult, isTokenUsage } from "./session-event.js";

describe("session event schema", () => {
  test("creates an event without filesystem side effects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-event-schema-"));
    const before = fs.readdirSync(dir);

    const event = createEvent("attempt_started", { attempt: 1 });

    expect(event.type).toBe("attempt_started");
    expect(event.version).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(before);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("exposes payload guards", () => {
    const step = { type: "task", task: "work" } as const;
    const usage = { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 };
    expect(isStep(step)).toBe(true);
    expect(isTokenUsage(usage)).toBe(true);
    expect(
      isStepResult({
        step,
        iterations: 1,
        result: "done",
        costUsd: 0,
        durationMs: 1,
        usage,
        exitReason: "done",
      }),
    ).toBe(true);
  });
});
