import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  acquireSessionLock,
  invalidateSessionLock,
  readSessionLock,
  refreshSessionLock,
  releaseSessionLock,
  startSessionLockMonitor,
} from "./session-lock";
import { getSessionLockMutationPath } from "./storage-paths.js";

const temporaryDirs: string[] = [];

function sessionDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-session-lock-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("session lock", () => {
  test("allows only one owner and releases conditionally", () => {
    const dir = sessionDir();
    const lock = acquireSessionLock(dir, "session-1", "attempt-1");

    expect(() => acquireSessionLock(dir, "session-1", "attempt-2")).toThrow();
    expect(releaseSessionLock(dir, "another-owner")).toBe(false);
    expect(readSessionLock(dir)).toEqual({ health: "active", lock });
    expect(releaseSessionLock(dir, lock.ownerId)).toBe(true);
    expect(readSessionLock(dir)).toEqual({ health: "unlocked" });
  });

  test("invalidates the expected lock only after recording maintenance", () => {
    const dir = sessionDir();
    const lock = acquireSessionLock(dir, "session-1");
    const recorded: string[] = [];

    invalidateSessionLock(dir, lock.ownerId, (ownerId) => recorded.push(ownerId));

    expect(recorded).toEqual([lock.ownerId]);
    expect(readSessionLock(dir).health).toBe("unlocked");
  });

  test("refuses invalidation when ownership changes during recording", () => {
    const dir = sessionDir();
    const lock = acquireSessionLock(dir, "session-1");

    expect(() =>
      invalidateSessionLock(dir, lock.ownerId, () => {
        fs.unlinkSync(path.join(dir, "active.lock"));
        acquireSessionLock(dir, "session-1");
      }),
    ).toThrow("ownership changed");
    expect(readSessionLock(dir).health).toBe("active");
  });

  test("reports ownership loss while work is active", async () => {
    const dir = sessionDir();
    const lock = acquireSessionLock(dir, "session-1");
    let lost = false;
    const monitor = startSessionLockMonitor(
      dir,
      lock.ownerId,
      () => {
        lost = true;
      },
      5,
    );

    fs.unlinkSync(path.join(dir, "active.lock"));
    for (let index = 0; index < 20 && !lost; index++) await Bun.sleep(5);
    monitor.stop();

    expect(lost).toBe(true);
  });

  test("serializes heartbeat updates with other lock mutations", async () => {
    const dir = sessionDir();
    const lock = acquireSessionLock(dir, "session-1");
    const mutationDir = getSessionLockMutationPath(dir);
    fs.mkdirSync(mutationDir);
    const remover = Bun.spawn(
      [
        process.execPath,
        "-e",
        `setTimeout(() => require("node:fs").rmdirSync(${JSON.stringify(mutationDir)}), 100)`,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );

    const startedAt = Date.now();
    expect(refreshSessionLock(dir, lock.ownerId)).toBe(true);
    const elapsed = Date.now() - startedAt;
    await remover.exited;

    expect(elapsed).toBeGreaterThanOrEqual(75);
  });

  test("refreshes only the current owner", async () => {
    const dir = sessionDir();
    const lock = acquireSessionLock(dir, "session-1");
    await Bun.sleep(2);

    expect(refreshSessionLock(dir, "another-owner")).toBe(false);
    expect(refreshSessionLock(dir, lock.ownerId)).toBe(true);
    const refreshed = readSessionLock(dir).lock;
    expect(refreshed?.ownerId).toBe(lock.ownerId);
    expect(Date.parse(refreshed?.heartbeatAt ?? "")).toBeGreaterThan(Date.parse(lock.heartbeatAt));
  });
});
