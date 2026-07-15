import type { ChildProcess } from "node:child_process";

export interface ChildProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface ChildProcessController {
  exited: Promise<void>;
  outcome: Promise<ChildProcessOutcome>;
  getOutcome(): ChildProcessOutcome | undefined;
  terminate(): NodeJS.Signals;
}

export interface ChildProcessControllerOptions {
  forceAfterMs?: number;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onForceKill?: () => void;
}

export function captureChildStderr(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
  maxCharacters = 8_192,
): () => string {
  let retained = "";
  let pendingLine = "";
  stream?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    retained = `${retained}${text}`.slice(-maxCharacters);
    pendingLine += text;
    let newline = pendingLine.indexOf("\n");
    while (newline !== -1) {
      const line = pendingLine.slice(0, newline).trim();
      if (line) onLine(line);
      pendingLine = pendingLine.slice(newline + 1);
      newline = pendingLine.indexOf("\n");
    }
  });
  stream?.on("end", () => {
    const line = pendingLine.trim();
    if (line) onLine(line);
    pendingLine = "";
  });
  return () => retained.trim();
}

export function childProcessFailure(
  name: string,
  outcome: ChildProcessOutcome,
  stderr: string,
): string | undefined {
  const detail = stderr ? `: ${stderr}` : "";
  if (outcome.error) return `Failed to start ${name}: ${outcome.error.message}${detail}`;
  if (outcome.code != null && outcome.code !== 0)
    return `${name} exited with code ${outcome.code}${detail}`;
  if (outcome.signal) return `${name} exited due to signal ${outcome.signal}${detail}`;
  return undefined;
}

export function createChildProcessController(
  process: ChildProcess,
  options: ChildProcessControllerOptions = {},
): ChildProcessController {
  const forceAfterMs = options.forceAfterMs ?? 2_000;
  let settled = false;
  let terminationRequested = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let settledOutcome: ChildProcessOutcome | undefined;

  const outcome = new Promise<ChildProcessOutcome>((resolve) => {
    const settle = (result: ChildProcessOutcome): void => {
      if (settled) return;
      settled = true;
      settledOutcome = result;
      if (forceTimer) clearTimeout(forceTimer);
      process.stdout?.destroy();
      process.stderr?.destroy();
      options.onExit?.(result.code, result.signal);
      resolve(result);
    };
    process.once("exit", (code, signal) => settle({ code, signal }));
    process.once("error", (error) => settle({ code: null, signal: null, error }));
  });
  const exited = outcome.then(() => undefined);

  return {
    exited,
    outcome,
    getOutcome: () => settledOutcome,
    terminate(): NodeJS.Signals {
      const signal: NodeJS.Signals = terminationRequested ? "SIGKILL" : "SIGTERM";
      terminationRequested = true;
      if (!settled) process.kill(signal);
      if (signal === "SIGTERM" && !forceTimer) {
        forceTimer = setTimeout(() => {
          if (settled) return;
          options.onForceKill?.();
          process.kill("SIGKILL");
        }, forceAfterMs);
        forceTimer.unref();
      }
      return signal;
    },
  };
}
