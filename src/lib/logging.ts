import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function appendJsonLine(logPath: string, entry: LogEntry): void {
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  } catch {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    } catch {
      // Silently ignore log failures (e.g. in tests with temp paths)
    }
  }
}

export const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export function createLogger(sessionDir: string): Logger {
  const logPath = path.join(sessionDir, "session.jsonl");

  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ...data,
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    appendJsonLine(logPath, entry);
  }

  return {
    debug(message, data) {
      log("debug", message, data);
    },
    info(message, data) {
      log("info", message, data);
    },
    warn(message, data) {
      log("warn", message, data);
    },
    error(message, data) {
      log("error", message, data);
    },
  };
}
