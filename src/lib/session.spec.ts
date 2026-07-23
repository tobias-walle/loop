import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLogger } from "./logging";
import type { SessionMetadata } from "./session";
import { createSessionDir, getProjectSlug, updateSessionStatus } from "./session";
import { getSessionEventsPath } from "./storage-paths";

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-session-test-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("sessions", () => {
  test("creates sessions under the state home and writes metadata", () => {
    const projectRoot = temporaryDir();
    const stateHome = temporaryDir();
    const now = new Date("2026-07-12T14:30:52.418Z");

    const sessionDir = createSessionDir(projectRoot, { LOOP_STATE_HOME: stateHome }, now);
    expect(path.dirname(sessionDir)).toBe(
      path.join(stateHome, "sessions", getProjectSlug(projectRoot)),
    );
    expect(path.basename(sessionDir)).toMatch(/^20260712T143052\.418Z-[a-f0-9]{8}$/);

    const metadata = JSON.parse(
      fs.readFileSync(path.join(sessionDir, "session.json"), "utf-8"),
    ) as SessionMetadata;
    expect(metadata).toEqual({
      id: path.basename(sessionDir),
      projectRoot: fs.realpathSync.native(projectRoot),
      createdAt: now.toISOString(),
      status: "running",
    });
  });

  test("writes lifecycle events separately from metadata", () => {
    const sessionDir = createSessionDir(temporaryDir(), { LOOP_STATE_HOME: temporaryDir() });
    createLogger(sessionDir).info("Started", { type: "test" });

    const entries = fs.readFileSync(getSessionEventsPath(sessionDir), "utf-8").trim().split("\n");
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0] ?? "{}")).toMatchObject({
      version: 1,
      type: "diagnostic",
      data: { level: "info", message: "Started", type: "test" },
    });
  });

  test("uses readable collision-safe project slugs", () => {
    const first = path.join(temporaryDir(), "My Project");
    const second = path.join(temporaryDir(), "My Project");
    fs.mkdirSync(first);
    fs.mkdirSync(second);

    expect(getProjectSlug(first)).toMatch(/^my-project-[a-f0-9]{8}$/);
    expect(getProjectSlug(first)).not.toBe(getProjectSlug(second));
  });

  test("updates session completion metadata", () => {
    const sessionDir = createSessionDir(temporaryDir(), { LOOP_STATE_HOME: temporaryDir() });
    updateSessionStatus(sessionDir, "completed");

    const metadata = JSON.parse(
      fs.readFileSync(path.join(sessionDir, "session.json"), "utf-8"),
    ) as SessionMetadata;
    expect(metadata.status).toBe("completed");
    expect(metadata.completedAt).toBeString();
  });
});
