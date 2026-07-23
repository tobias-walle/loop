import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendSessionEvent, createEvent, readSessionEvents } from "./session-events";
import { getSessionEventsPath } from "./storage-paths";

const temporaryDirs: string[] = [];

function sessionDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-session-events-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("session events", () => {
  test("appends and reads versioned events", () => {
    const dir = sessionDir();
    const first = createEvent("attempt_started", { attempt: 1 });
    const second = createEvent("attempt_completed", {});

    appendSessionEvent(dir, first);
    appendSessionEvent(dir, second);

    expect(readSessionEvents(dir)).toEqual({
      events: [first, second],
      warnings: [],
      unsupportedVersion: false,
    });
    expect(fs.statSync(getSessionEventsPath(dir)).mode & 0o777).toBe(0o600);
  });

  test("retries three failed writes before succeeding", () => {
    const dir = sessionDir();
    let attempts = 0;
    const append = spyOn(fs, "appendFileSync").mockImplementation(() => {
      attempts++;
      if (attempts <= 3) throw new Error("temporary mount failure");
    });
    const errors: string[] = [];

    try {
      expect(
        appendSessionEvent(dir, createEvent("attempt_started", {}), (error) => {
          errors.push(error.message);
        }),
      ).toBe(true);
    } finally {
      append.mockRestore();
    }

    expect(attempts).toBe(4);
    expect(errors).toEqual([]);
  });

  test("reports event write failures without throwing or repeating the warning", () => {
    const dir = sessionDir();
    const eventsPath = getSessionEventsPath(dir);
    fs.mkdirSync(eventsPath);
    const errors: string[] = [];
    const onError = (error: Error): void => {
      errors.push(error.message);
    };

    expect(appendSessionEvent(dir, createEvent("attempt_started", {}), onError)).toBe(false);
    expect(appendSessionEvent(dir, createEvent("attempt_completed", {}), onError)).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(eventsPath);
  });

  test("ignores an interrupted final append", () => {
    const dir = sessionDir();
    const event = createEvent("attempt_started", {});
    fs.writeFileSync(getSessionEventsPath(dir), `${JSON.stringify(event)}\n{"version":`);

    const result = readSessionEvents(dir);

    expect(result.events).toEqual([event]);
    expect(result.warnings).toEqual(["Ignored malformed final event line."]);
    expect(result.unsupportedVersion).toBe(false);
  });

  test("marks unsupported versions as non-authoritative", () => {
    const dir = sessionDir();
    const event = { ...createEvent("attempt_started", {}), version: 2 };
    fs.writeFileSync(getSessionEventsPath(dir), `${JSON.stringify(event)}\n`);

    const result = readSessionEvents(dir);

    expect(result.events).toEqual([]);
    expect(result.unsupportedVersion).toBe(true);
    expect(result.warnings).toEqual(["Unsupported event version at line 1."]);
  });

  test("ignores events whose data is not an object", () => {
    const dir = sessionDir();
    const event = { ...createEvent("lock_invalidated", {}), data: null };
    fs.writeFileSync(getSessionEventsPath(dir), `${JSON.stringify(event)}\n`);

    const result = readSessionEvents(dir);

    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual(["Ignored malformed event at line 1."]);
  });

  test("ignores unknown event types", () => {
    const dir = sessionDir();
    const event = { ...createEvent("diagnostic", {}), type: "future_event" };
    fs.writeFileSync(getSessionEventsPath(dir), `${JSON.stringify(event)}\n`);

    const result = readSessionEvents(dir);

    expect(result.events).toEqual([]);
    expect(result.warnings).toEqual(["Ignored malformed event at line 1."]);
  });
});
