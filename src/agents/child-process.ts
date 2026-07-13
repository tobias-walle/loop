import type { ChildProcess } from "node:child_process";

export interface ChildProcessController {
  exited: Promise<void>;
  terminate(): NodeJS.Signals;
}

export interface ChildProcessControllerOptions {
  forceAfterMs?: number;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onForceKill?: () => void;
}

export function createChildProcessController(
  process: ChildProcess,
  options: ChildProcessControllerOptions = {},
): ChildProcessController {
  const forceAfterMs = options.forceAfterMs ?? 2_000;
  let settled = false;
  let terminationRequested = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  const exited = new Promise<void>((resolve) => {
    const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      process.stdout?.destroy();
      process.stderr?.destroy();
      options.onExit?.(code, signal);
      resolve();
    };
    process.once("exit", settle);
    process.once("error", () => settle(null, null));
  });

  return {
    exited,
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
