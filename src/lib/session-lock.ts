import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { lockSync } from "proper-lockfile";
import { getSessionLockMutationPath, getSessionLockPath } from "./storage-paths.js";

export type SessionLock = {
  version: 1;
  sessionId: string;
  ownerId: string;
  attemptId: string;
  pid: number;
  hostname: string;
  createdAt: string;
  heartbeatAt: string;
};
export type LockHealth = "active" | "stale" | "unknown" | "unlocked";
export type LockInfo = { health: LockHealth; lock?: SessionLock; error?: string };

export function acquireSessionLock(
  sessionDir: string,
  sessionId: string,
  attemptId = crypto.randomUUID(),
): SessionLock {
  const lock: SessionLock = {
    version: 1,
    sessionId,
    ownerId: crypto.randomUUID(),
    attemptId,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  return withLockMutation(sessionDir, () => {
    fs.writeFileSync(getSessionLockPath(sessionDir), `${JSON.stringify(lock)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return lock;
  });
}

export function readSessionLock(sessionDir: string): LockInfo {
  const file = getSessionLockPath(sessionDir);
  if (!fs.existsSync(file)) return { health: "unlocked" };
  try {
    const lock = JSON.parse(fs.readFileSync(file, "utf-8")) as SessionLock;
    if (!isLock(lock)) return { health: "unknown", error: "Malformed lock file." };
    return { health: classifyLock(lock), lock };
  } catch (error) {
    return { health: "unknown", error: error instanceof Error ? error.message : String(error) };
  }
}

export function invalidateSessionLock(
  sessionDir: string,
  expectedOwnerId: string,
  recordInvalidation: (ownerId: string) => void,
): void {
  const before = readSessionLock(sessionDir);
  if (!before.lock || before.lock.ownerId !== expectedOwnerId)
    throw new Error("Session lock ownership changed before deletion.");
  recordInvalidation(expectedOwnerId);
  withLockMutation(sessionDir, () => {
    const after = readSessionLock(sessionDir);
    if (!after.lock || after.lock.ownerId !== expectedOwnerId)
      throw new Error("Session lock ownership changed during deletion.");
    fs.unlinkSync(getSessionLockPath(sessionDir));
  });
}

export function refreshSessionLock(sessionDir: string, ownerId: string): boolean {
  return withLockMutation(sessionDir, () => {
    const info = readSessionLock(sessionDir);
    if (!info.lock || info.lock.ownerId !== ownerId) return false;
    const lock = { ...info.lock, heartbeatAt: new Date().toISOString() };
    fs.writeFileSync(getSessionLockPath(sessionDir), `${JSON.stringify(lock)}\n`, { mode: 0o600 });
    return true;
  });
}

export function releaseSessionLock(sessionDir: string, ownerId: string): boolean {
  return withLockMutation(sessionDir, () => {
    const info = readSessionLock(sessionDir);
    if (!info.lock || info.lock.ownerId !== ownerId) return false;
    fs.unlinkSync(getSessionLockPath(sessionDir));
    return true;
  });
}

export function startSessionLockMonitor(
  sessionDir: string,
  ownerId: string,
  onLost: () => void,
  intervalMs = 1_000,
): { stop(): void } {
  let reported = false;
  const timer = setInterval(() => {
    if (!reported && readSessionLock(sessionDir).lock?.ownerId !== ownerId) {
      reported = true;
      onLost();
    }
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

export function startLockHeartbeat(
  sessionDir: string,
  ownerId: string,
  intervalMs = 10_000,
): { stop(): void; ownsLock(): boolean } {
  let owns = true;
  const timer = setInterval(() => {
    owns = refreshSessionLock(sessionDir, ownerId);
  }, intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    ownsLock: () => owns && readSessionLock(sessionDir).lock?.ownerId === ownerId,
  };
}

function withLockMutation<T>(sessionDir: string, mutate: () => T): T {
  const lockPath = getSessionLockPath(sessionDir);
  let release: (() => void) | undefined;
  for (let attempt = 0; attempt <= 100; attempt++) {
    try {
      release = lockSync(lockPath, {
        realpath: false,
        lockfilePath: getSessionLockMutationPath(sessionDir),
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt === 100) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!release) throw new Error("Failed to acquire session lock mutation guard.");
  try {
    return mutate();
  } finally {
    release();
  }
}

function classifyLock(lock: SessionLock): LockHealth {
  if (lock.hostname !== os.hostname()) return "unknown";
  const heartbeatAge = Date.now() - Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(heartbeatAge) || heartbeatAge > 30_000) return "stale";
  try {
    process.kill(lock.pid, 0);
    return "active";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ESRCH" ? "stale" : "unknown";
  }
}
function isLock(value: SessionLock): boolean {
  return (
    value.version === 1 &&
    typeof value.sessionId === "string" &&
    typeof value.ownerId === "string" &&
    typeof value.attemptId === "string" &&
    typeof value.pid === "number" &&
    typeof value.hostname === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.heartbeatAt === "string"
  );
}
