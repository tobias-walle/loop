import * as fs from "node:fs";
import * as path from "node:path";
import { readLegacyHistory, toLegacyOverview } from "./legacy-session.js";
import { stringField } from "./record-fields.js";
import { readSessionEvents } from "./session-event-store.js";
import type { SessionEvent, StoredInvocation } from "./session-event.js";
import { type LockInfo, readSessionLock } from "./session-lock.js";
import { type SessionAggregate, reduceSessionEvents } from "./session-reducer.js";
import {
  getLegacyProjectSessionsDir,
  getLegacySessionEventsPath,
  getSessionMetadataPath,
  getSessionsDir,
} from "./storage-paths.js";
import type { Step } from "./types.js";

export type SessionMetadataV2 = {
  schemaVersion: 2;
  projectedThroughEventId: string;
  id: string;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "failed" | "aborted";
  title: string;
  agent: "claude" | "pi";
  model?: string;
  attemptCount: number;
  progress: { completedSteps: number; totalSteps: number; activeStep?: number };
  totals: SessionAggregate["totals"];
  lastError?: string;
};
export type SessionOverview = {
  sessionDir: string;
  id: string;
  projectRoot?: string;
  title: string;
  status: SessionAggregate["status"];
  agent?: "claude" | "pi";
  model?: string;
  createdAt: string;
  updatedAt: string;
  completedSteps: number;
  totalSteps?: number;
  attemptCount: number;
  totals: SessionAggregate["totals"];
  canResume: boolean;
  disabledReason?: string;
  interrupted: boolean;
  lock: LockInfo;
  legacy: boolean;
};

export type SessionRecord = {
  sessionDir: string;
  metadata?: SessionMetadataV2;
  aggregate: SessionAggregate;
  events: SessionEvent[];
  legacy: boolean;
};

export type SessionHistory = {
  warnings: string[];
  events?: SessionEvent[];
  invocation?: StoredInvocation;
  lines?: string[];
};

export function discoverSessions(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): SessionOverview[] {
  const sessionsRoot = getSessionsDir(env);
  const sessionDirs: string[] = [];
  for (const project of safeReadDir(sessionsRoot)) {
    const projectDir = path.join(sessionsRoot, project);
    if (!safeIsDirectory(projectDir)) continue;
    for (const sessionId of safeReadDir(projectDir)) {
      const sessionDir = path.join(projectDir, sessionId);
      if (safeIsDirectory(sessionDir)) sessionDirs.push(sessionDir);
    }
  }

  const legacyRoot = getLegacyProjectSessionsDir(cwd);
  const legacy = safeReadDir(legacyRoot)
    .map((name) => path.join(legacyRoot, name))
    .filter((dir) => safeIsDirectory(dir) && fs.existsSync(getLegacySessionEventsPath(dir)))
    .map((dir) => toLegacyOverview(dir, cwd));
  return [...sessionDirs.map(toOverview), ...legacy].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function loadSession(sessionDir: string): SessionRecord {
  const read = readSessionEvents(sessionDir);
  const aggregate = reduceSessionEvents(read.events);
  aggregate.warnings.push(...read.warnings);
  if (read.unsupportedVersion) aggregate.resumable = false;
  const metadata = readMetadata(sessionDir);
  return {
    sessionDir,
    metadata:
      metadata && metadata.projectedThroughEventId === aggregate.lastEventId ? metadata : undefined,
    aggregate,
    events: read.events,
    legacy: !aggregate.invocation || read.unsupportedVersion,
  };
}

export function loadSessionHistory(session: SessionOverview): SessionHistory {
  if (session.legacy && fs.existsSync(getLegacySessionEventsPath(session.sessionDir))) {
    return { warnings: [], lines: readLegacyHistory(session.sessionDir) };
  }
  const loaded = loadSession(session.sessionDir);
  return {
    warnings: loaded.aggregate.warnings,
    events: loaded.events,
    invocation: loaded.aggregate.invocation,
  };
}

export function writeSessionProjection(sessionDir: string, aggregate: SessionAggregate): void {
  const invocation = aggregate.invocation;
  if (!(invocation && aggregate.lastEventId)) return;
  const finalAttempt = aggregate.attempts.at(-1);
  const metadata: SessionMetadataV2 = {
    schemaVersion: 2,
    projectedThroughEventId: aggregate.lastEventId,
    id: invocation.sessionId,
    projectRoot: invocation.projectRoot,
    createdAt: aggregate.attempts[0]?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status:
      aggregate.status === "completed"
        ? "completed"
        : aggregate.status === "failed"
          ? "failed"
          : aggregate.status === "aborted"
            ? "aborted"
            : "running",
    title: invocation.recipe?.name ?? stepTitle(invocation.steps[0]),
    agent: invocation.agent.name,
    model: invocation.agent.model,
    attemptCount: aggregate.attempts.length,
    progress: {
      completedSteps: aggregate.completedSteps.size,
      totalSteps: invocation.steps.length,
      activeStep: aggregate.activeStepIndex,
    },
    totals: aggregate.totals,
    ...(finalAttempt?.status === "failed" ? { lastError: "Last attempt failed." } : {}),
  };
  fs.writeFileSync(getSessionMetadataPath(sessionDir), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function toOverview(sessionDir: string): SessionOverview {
  const record = loadSession(sessionDir);
  const { aggregate } = record;
  const invocation = aggregate.invocation;
  const rawMetadata = readRawMetadata(sessionDir);
  const createdAt =
    record.events.find((event) => event.type === "session_created")?.timestamp ??
    stringField(rawMetadata, "createdAt") ??
    fs.statSync(sessionDir).birthtime.toISOString();
  const updatedAt =
    record.events.at(-1)?.timestamp ??
    stringField(rawMetadata, "updatedAt") ??
    stringField(rawMetadata, "completedAt") ??
    createdAt;
  const projectRoot = invocation?.projectRoot ?? stringField(rawMetadata, "projectRoot");
  const lock = readSessionLock(sessionDir);
  const disabledReason = resumeDisabledReason(record, projectRoot, lock);
  return {
    sessionDir,
    id: invocation?.sessionId ?? stringField(rawMetadata, "id") ?? path.basename(sessionDir),
    projectRoot,
    title: invocation?.recipe?.name ?? stepTitle(invocation?.steps[0]),
    status: aggregate.status,
    agent: invocation?.agent.name,
    model: invocation?.agent.model,
    createdAt,
    updatedAt,
    completedSteps: aggregate.completedSteps.size,
    totalSteps: invocation?.steps.length,
    attemptCount: aggregate.attempts.length,
    totals: aggregate.totals,
    canResume: disabledReason === undefined,
    disabledReason,
    interrupted: aggregate.interrupted,
    lock,
    legacy: record.legacy,
  };
}

function resumeDisabledReason(
  record: SessionRecord,
  projectRoot: string | undefined,
  lock: LockInfo,
): string | undefined {
  if (record.aggregate.status === "corrupt") return "Session events are corrupt.";
  if (record.legacy) return "This session predates resume support and is history only.";
  if (record.aggregate.status === "completed") return "No unfinished workflow remains.";
  if (!(projectRoot && fs.existsSync(projectRoot)))
    return "The stored project path does not exist.";
  if (lock.health !== "unlocked") return "The session is locked. Delete the lock before resuming.";
  if (!record.aggregate.resumable) return "This session cannot be resumed.";
  return undefined;
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function readRawMetadata(sessionDir: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(getSessionMetadataPath(sessionDir), "utf-8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function readMetadata(sessionDir: string): SessionMetadataV2 | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(getSessionMetadataPath(sessionDir), "utf-8"));
    if (
      !value ||
      typeof value !== "object" ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 2
    )
      return undefined;
    return value as SessionMetadataV2;
  } catch {
    return undefined;
  }
}
function stepTitle(step: Step | undefined): string {
  if (!step) return "Untitled session";
  return step.type === "task" ? step.task : step.tasks.join(", ");
}
