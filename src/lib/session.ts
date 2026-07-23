import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendSessionEvent } from "./session-event-store.js";
import { type SessionEvent, type StoredInvocation, createEvent } from "./session-event.js";
import { reduceSessionEvents } from "./session-reducer.js";
import { writeSessionProjection } from "./session-store.js";
import { getSessionMetadataPath, getSessionsDir } from "./storage-paths.js";

export type SessionStatus = "running" | "completed" | "failed" | "aborted";

export interface SessionMetadata {
  id: string;
  projectRoot: string;
  createdAt: string;
  completedAt?: string;
  status: SessionStatus;
}

function canonicalProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function getProjectSlug(projectRoot: string): string {
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  const name = path
    .basename(canonicalRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const readableName = name.replace(/^-+|-+$/g, "") || "project";
  const hash = crypto.createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 8);
  return `${readableName}-${hash}`;
}

function createSessionId(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "");
  return `${timestamp}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createSessionDir(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): string {
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  const id = createSessionId(now);
  const dir = path.join(getSessionsDir(env), getProjectSlug(canonicalRoot), id);
  const metadata: SessionMetadata = {
    id,
    projectRoot: canonicalRoot,
    createdAt: now.toISOString(),
    status: "running",
  };

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(getSessionMetadataPath(dir), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return dir;
}

export function createResumableSession(
  invocation: Omit<StoredInvocation, "sessionId" | "projectRoot"> & { projectRoot?: string },
  env: NodeJS.ProcessEnv = process.env,
): {
  sessionDir: string;
  invocation: StoredInvocation;
  createdEvent: SessionEvent<StoredInvocation>;
} {
  const projectRoot = invocation.projectRoot ?? process.cwd();
  const sessionDir = createSessionDir(projectRoot, env);
  const stored: StoredInvocation = {
    ...invocation,
    sessionId: path.basename(sessionDir),
    projectRoot: canonicalProjectRoot(projectRoot),
  };
  const created = createEvent("session_created", stored);
  appendSessionEvent(sessionDir, created);
  writeSessionProjection(sessionDir, reduceSessionEvents([created]));
  return { sessionDir, invocation: stored, createdEvent: created };
}

export function updateSessionStatus(
  sessionDir: string,
  status: Exclude<SessionStatus, "running">,
): void {
  try {
    const file = getSessionMetadataPath(sessionDir);
    const metadata = JSON.parse(fs.readFileSync(file, "utf-8")) as SessionMetadata;
    const updated: SessionMetadata = {
      ...metadata,
      completedAt: new Date().toISOString(),
      status,
    };
    fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
  } catch {
    // Session metadata must not prevent Loop from terminating cleanly.
  }
}
