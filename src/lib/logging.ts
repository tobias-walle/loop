import { appendSessionEvent } from "./session-event-store.js";
import { type SessionEvent, createEvent } from "./session-event.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}
export const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export function createLogger(
  sessionDir: string,
  ownership: { attemptId?: string; ownerId?: string } = {},
  onEvent?: (event: SessionEvent) => void,
): Logger {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const event = createEvent("diagnostic", { level, message, ...data }, ownership);
    appendSessionEvent(sessionDir, event);
    onEvent?.(event);
  }
  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
  };
}
