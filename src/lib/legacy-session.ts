import * as fs from "node:fs";
import * as path from "node:path";
import { stringField } from "./record-fields.js";
import type { SessionOverview } from "./session-store.js";
import { getLegacySessionEventsPath } from "./storage-paths.js";

export function readLegacyHistory(sessionDir: string): string[] {
  const contents = fs.readFileSync(getLegacySessionEventsPath(sessionDir), "utf-8");
  const lines: string[] = [];
  for (const rawLine of contents.split("\n")) {
    if (!rawLine) continue;
    try {
      const entry = JSON.parse(rawLine) as Record<string, unknown>;
      const timestamp = stringField(entry, "timestamp")?.replace("T", " ").slice(0, 19);
      const level = stringField(entry, "level");
      const message = stringField(entry, "message") ?? stringField(entry, "type") ?? "Event";
      const eventType = stringField(entry, "eventType");
      lines.push(
        [timestamp, level, message, eventType ? `· ${eventType}` : undefined]
          .filter(Boolean)
          .join(" "),
      );
    } catch {
      lines.push(rawLine);
    }
  }
  return lines;
}

export function toLegacyOverview(sessionDir: string, projectRoot: string): SessionOverview {
  const eventsFile = getLegacySessionEventsPath(sessionDir);
  const stat = fs.statSync(eventsFile);
  const lines = fs.readFileSync(eventsFile, "utf-8").split("\n").filter(Boolean);
  let first: Record<string, unknown> | undefined;
  try {
    first = lines[0] ? (JSON.parse(lines[0]) as Record<string, unknown>) : undefined;
  } catch {
    first = undefined;
  }
  const createdAt = stringField(first, "timestamp") ?? stat.birthtime.toISOString();
  return {
    sessionDir,
    id: path.basename(sessionDir),
    projectRoot,
    title: stringField(first, "task") ?? "Legacy session",
    status: "legacy",
    createdAt,
    updatedAt: stat.mtime.toISOString(),
    completedSteps: 0,
    attemptCount: 0,
    totals: {
      totalCostUsd: 0,
      totalDurationMs: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    },
    canResume: false,
    disabledReason: "This session predates resume support and is history only.",
    interrupted: false,
    lock: { health: "unlocked" },
    legacy: true,
  };
}
