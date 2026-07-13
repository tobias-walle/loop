import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendSessionEvent, createEvent } from "./session-events.js";
import { discoverSessions, loadSessionHistory } from "./session-store.js";
import { createResumableSession } from "./session.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-discovery-"));
  roots.push(root);
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot);
  const env = { ...process.env, LOOP_STATE_HOME: path.join(root, "state") };
  const created = createResumableSession(
    {
      loopVersion: "test",
      projectRoot,
      steps: [{ type: "task", task: "Fix tests" }],
      template: { source: "default", content: "{{task}}", sha256: "hash" },
      agent: { name: "claude", args: {}, passthroughArgs: [] },
    },
    env,
  );
  return { root, projectRoot, env, ...created };
}

describe("discoverSessions", () => {
  test("finds resumable sessions and sorts newest activity first", () => {
    const older = fixture();
    const newer = fixture();
    appendSessionEvent(
      older.sessionDir,
      createEvent("attempt_aborted", {}, { attemptId: "old", ownerId: "owner" }),
    );
    const event = createEvent("attempt_aborted", {}, { attemptId: "new", ownerId: "owner" });
    event.timestamp = "2099-01-01T00:00:00.000Z";
    appendSessionEvent(newer.sessionDir, event);

    // Both fixtures use separate state homes, so copy the older session into the newer state home.
    const destination = path.join(
      path.dirname(path.dirname(newer.sessionDir)),
      path.basename(path.dirname(older.sessionDir)),
    );
    fs.cpSync(path.dirname(older.sessionDir), destination, { recursive: true });

    const sessions = discoverSessions(newer.env, newer.projectRoot);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionDir).toBe(newer.sessionDir);
    expect(sessions[0].canResume).toBe(true);
    expect(sessions[0].title).toBe("Fix tests");
  });

  test("discovers project-local legacy sessions as history only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-legacy-discovery-"));
    roots.push(root);
    const projectRoot = path.join(root, "project");
    const legacyDir = path.join(projectRoot, ".loop", "sessions", "20260101-legacy");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "session.jsonl"),
      `${[
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00.000Z",
          level: "info",
          message: "Session initialized",
          task: "Old task",
        }),
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01.000Z",
          level: "debug",
          message: "Agent event",
          eventType: "text_delta",
        }),
      ].join("\n")}\n`,
    );
    const env = { ...process.env, LOOP_STATE_HOME: path.join(root, "state") };

    const sessions = discoverSessions(env, projectRoot);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].legacy).toBe(true);
    expect(sessions[0].canResume).toBe(false);
    expect(sessions[0].projectRoot).toBe(projectRoot);
    expect(loadSessionHistory(sessions[0]).lines).toEqual([
      "2026-01-01 00:00:00 info Session initialized",
      "2026-01-01 00:00:01 debug Agent event · text_delta",
    ]);
  });

  test("keeps missing projects visible but disables resume", () => {
    const item = fixture();
    fs.rmSync(item.projectRoot, { recursive: true });

    const [session] = discoverSessions(item.env, item.projectRoot);

    expect(session.canResume).toBe(false);
    expect(session.disabledReason).toContain("project path does not exist");
  });
});
