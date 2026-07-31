import type { Readable } from "node:stream";
import { execa } from "execa";

export interface ChildProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: Error;
}

export interface ChildProcessHandle {
  pid: number | undefined;
  stdout: Readable;
  result: Promise<ChildProcessResult>;
  isRunning(): boolean;
  abort(): void;
}

export interface ChildProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  forceAfterMs?: number;
}

export interface ChildProcessSpawnInput extends ChildProcessOptions {
  command: string;
  args: string[];
}

export type SpawnChildProcess = (input: ChildProcessSpawnInput) => ChildProcessHandle;

export const spawnChildProcessFromInput: SpawnChildProcess = ({ command, args, ...options }) =>
  spawnChildProcess(command, args, options);

export function spawnChildProcess(
  command: string,
  args: string[],
  options: ChildProcessOptions = {},
): ChildProcessHandle {
  const subprocess = execa(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    reject: false,
    forceKillAfterDelay: options.forceAfterMs ?? 2_000,
    buffer: { stdout: false, stderr: true },
  });
  // Execa waits for stdio to close. A detached descendant can retain those
  // descriptors after this process exits, so close them at the actual exit.
  subprocess.nodeChildProcess.once("exit", () => {
    subprocess.stdout?.destroy();
    subprocess.stderr?.destroy();
  });

  const result = subprocess.then(
    (value): ChildProcessResult => ({
      exitCode: value.exitCode ?? null,
      signal: (value.signal as NodeJS.Signals | undefined) ?? null,
      stderr: typeof value.stderr === "string" ? value.stderr.slice(-8_192).trim() : "",
      error: processError(value),
    }),
  );

  return {
    pid: subprocess.pid,
    stdout: subprocess.stdout,
    result,
    isRunning: () =>
      subprocess.nodeChildProcess.exitCode == null &&
      subprocess.nodeChildProcess.signalCode == null,
    abort: () => {
      subprocess.kill();
    },
  };
}

export function childProcessFailure(name: string, result: ChildProcessResult): string | undefined {
  const detail = result.stderr ? `: ${result.stderr}` : "";
  if (result.error) return `Failed to start ${name}: ${result.error.message}${detail}`;
  if (result.exitCode != null && result.exitCode !== 0)
    return `${name} exited with code ${result.exitCode}${detail}`;
  if (result.signal) return `${name} exited due to signal ${result.signal}${detail}`;
  return undefined;
}

function processError(result: Awaited<ReturnType<typeof execa>>): Error | undefined {
  if (!result.failed || result.exitCode !== undefined || result.signal !== undefined)
    return undefined;
  if (result.cause instanceof Error) return result.cause;
  return new Error(result.shortMessage ?? result.message ?? "Failed to start process");
}
