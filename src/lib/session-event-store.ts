import * as fs from "node:fs";
import { yellow } from "./ansi.js";
import { isSessionEvent, type SessionEvent } from "./session-event.js";
import { getSessionEventsPath } from "./storage-paths.js";

const SESSION_EVENT_WRITE_RETRIES = 3;
const failedEventPaths = new Set<string>();

export function appendSessionEvent(
  sessionDir: string,
  event: SessionEvent,
  onError: (error: Error) => void = reportSessionEventWriteFailure,
): boolean {
  const file = getSessionEventsPath(sessionDir);
  let cause: unknown;
  for (let attempt = 0; attempt <= SESSION_EVENT_WRITE_RETRIES; attempt++) {
    try {
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
      failedEventPaths.delete(file);
      return true;
    } catch (error) {
      cause = error;
    }
  }

  if (!failedEventPaths.has(file)) {
    failedEventPaths.add(file);
    const detail = cause instanceof Error ? cause.message : String(cause);
    try {
      onError(
        new Error(
          `Could not append session events to ${file} after ${SESSION_EVENT_WRITE_RETRIES} retries: ${detail}. The run will continue without recording this event.`,
        ),
      );
    } catch {
      // Reporting a persistence failure must not stop the active run either.
    }
  }
  return false;
}

function reportSessionEventWriteFailure(error: Error): void {
  process.stderr.write(`${yellow("Warning:")} ${error.message}\n`);
}

export type ReadEventsResult = {
  events: SessionEvent[];
  warnings: string[];
  unsupportedVersion: boolean;
};

export function readSessionEvents(sessionDir: string): ReadEventsResult {
  const file = getSessionEventsPath(sessionDir);
  if (!fs.existsSync(file)) return { events: [], warnings: [], unsupportedVersion: false };
  const contents = fs.readFileSync(file, "utf-8");
  const lines = contents.split("\n");
  const events: SessionEvent[] = [];
  const warnings: string[] = [];
  let unsupportedVersion = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!isSessionEvent(value)) {
        if (index === lines.length - 1 && !contents.endsWith("\n")) {
          warnings.push("Ignored malformed final event line.");
          continue;
        }
        warnings.push(`Ignored malformed event at line ${index + 1}.`);
        continue;
      }
      if (value.version !== 1) {
        unsupportedVersion = true;
        warnings.push(`Unsupported event version at line ${index + 1}.`);
        continue;
      }
      events.push(value);
    } catch {
      if (index === lines.length - 1 && !contents.endsWith("\n"))
        warnings.push("Ignored malformed final event line.");
      else warnings.push(`Ignored malformed event at line ${index + 1}.`);
    }
  }
  return { events, warnings, unsupportedVersion };
}
