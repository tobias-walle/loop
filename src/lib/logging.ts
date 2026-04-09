import * as fs from "node:fs";
import * as path from "node:path";

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  event(entry: Record<string, unknown>): void;
}

function appendToLog(logPath: string, line: string): void {
  try {
    fs.appendFileSync(logPath, `${line}\n`);
  } catch {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${line}\n`);
    } catch {
      // Silently ignore log failures (e.g. in tests with temp paths)
    }
  }
}

export function createLogger(sessionDir: string): Logger {
  const logPath = path.join(sessionDir, "loop.log");
  const eventPath = path.join(sessionDir, "messages.jsonl");

  function log(level: string, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const suffix = data ? ` ${JSON.stringify(data)}` : "";
    appendToLog(logPath, `[${timestamp}] ${level}: ${message}${suffix}`);
  }

  return {
    info(message, data) {
      log("INFO", message, data);
    },
    debug(message, data) {
      log("DEBUG", message, data);
    },
    warn(message, data) {
      log("WARN", message, data);
    },
    error(message, data) {
      log("ERROR", message, data);
    },
    event(entry) {
      const line = { timestamp: new Date().toISOString(), ...entry };
      try {
        fs.appendFileSync(eventPath, `${JSON.stringify(line)}\n`);
      } catch {
        // Silently ignore write failures
      }
    },
  };
}
