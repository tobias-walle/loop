import { PassThrough } from "node:stream";
import type {
  ChildProcessHandle,
  ChildProcessResult,
  ChildProcessSpawnInput,
  SpawnChildProcess,
} from "../agents/utils/child-process.js";

type OutputChunk = string | Uint8Array;

export type FakeProcessOperation =
  | { type: "stdout"; chunks: readonly OutputChunk[] }
  | { type: "checkpoint"; name: string };

export interface FakeProcessRun {
  stdoutChunks?: readonly OutputChunk[];
  operations?: readonly FakeProcessOperation[];
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  spawnError?: Error;
  deferred?: boolean;
  optional?: boolean;
}

export interface FakeProcessState {
  readonly invocation: ChildProcessSpawnInput;
  readonly abortRequested: boolean;
  readonly running: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface Checkpoint {
  reached: Deferred<void>;
  released: Deferred<void>;
  isReached: boolean;
  isReleased: boolean;
}

interface OwnedProcess {
  invocation: ChildProcessSpawnInput;
  run: FakeProcessRun;
  stdout: PassThrough;
  result: Deferred<ChildProcessResult>;
  running: boolean;
  abortRequested: boolean;
  stdoutEnded: boolean;
}

export interface FakeProcessSpawner {
  readonly spawn: SpawnChildProcess;
  givenRun(run: FakeProcessRun): void;
  invocations(): readonly ChildProcessSpawnInput[];
  processes(): readonly FakeProcessState[];
  waitForCheckpoint(name: string): Promise<void>;
  releaseCheckpoint(name: string): void;
  complete(index: number, result?: Partial<ChildProcessResult>): void;
  resources(): { queuedRuns: number; runningProcesses: number };
  assertIdle(): void;
  [Symbol.asyncDispose](): Promise<void>;
}

export function createFakeProcessSpawner(): FakeProcessSpawner {
  const queued: FakeProcessRun[] = [];
  const owned: OwnedProcess[] = [];
  const checkpoints = new Map<string, Checkpoint>();

  const finish = (process: OwnedProcess, overrides: Partial<ChildProcessResult> = {}): void => {
    if (!process.running)
      throw new Error("Invalid process lifecycle transition: already completed");
    process.running = false;
    endStdout(process);
    process.result.resolve({
      exitCode: process.run.exitCode ?? (process.run.spawnError ? null : 0),
      signal: process.run.signal ?? null,
      stderr: process.run.stderr ?? "",
      ...(process.run.spawnError ? { error: process.run.spawnError } : {}),
      ...overrides,
    });
  };

  const spawn: SpawnChildProcess = (invocation) => {
    const run = queued.shift();
    if (!run) {
      throw new Error(
        `Unexpected process invocation: ${JSON.stringify(invocation)}. No queued runs remain.`,
      );
    }

    const stdout = new PassThrough();
    const result = deferred<ChildProcessResult>();
    const process: OwnedProcess = {
      invocation: copyInvocation(invocation),
      run,
      stdout,
      result,
      running: true,
      abortRequested: false,
      stdoutEnded: false,
    };
    owned.push(process);

    const handle: ChildProcessHandle = {
      pid: owned.length,
      stdout,
      result: result.promise,
      isRunning: () => process.running,
      abort: () => {
        if (!process.running) return;
        process.abortRequested = true;
        finish(process, { exitCode: null, signal: "SIGTERM" });
      },
    };

    void emitRun(process).then(() => {
      if (process.running && !run.deferred) finish(process);
    });
    return handle;
  };

  async function emitRun(process: OwnedProcess): Promise<void> {
    const operations = process.run.operations ?? [
      { type: "stdout" as const, chunks: process.run.stdoutChunks ?? [] },
    ];
    for (const operation of operations) {
      if (!process.running) return;
      if (operation.type === "stdout") {
        for (const chunk of operation.chunks) {
          if (!process.running) return;
          process.stdout.write(chunk);
          await Promise.resolve();
        }
        continue;
      }

      const checkpoint = getOrCreateCheckpoint(checkpoints, operation.name);
      if (checkpoint.isReached) {
        throw new Error(`Checkpoint "${operation.name}" was arranged more than once`);
      }
      checkpoint.isReached = true;
      checkpoint.reached.resolve();
      await checkpoint.released.promise;
    }
    endStdout(process);
  }

  const api: FakeProcessSpawner = {
    spawn,
    givenRun(run) {
      queued.push(run);
    },
    invocations: () => owned.map((process) => copyInvocation(process.invocation)),
    processes: () =>
      owned.map((process) => ({
        invocation: copyInvocation(process.invocation),
        abortRequested: process.abortRequested,
        running: process.running,
      })),
    waitForCheckpoint(name) {
      return getOrCreateCheckpoint(checkpoints, name).reached.promise;
    },
    releaseCheckpoint(name) {
      const checkpoint = checkpoints.get(name);
      if (!checkpoint?.isReached) throw new Error(`Checkpoint "${name}" has not been reached`);
      if (checkpoint.isReleased) throw new Error(`Checkpoint "${name}" was already released`);
      checkpoint.isReleased = true;
      checkpoint.released.resolve();
    },
    complete(index, resultOverrides) {
      const process = owned[index];
      if (!process) throw new Error(`Process invocation ${index} does not exist`);
      finish(process, resultOverrides);
    },
    resources: () => ({
      queuedRuns: queued.filter((run) => !run.optional).length,
      runningProcesses: owned.filter((process) => process.running).length,
    }),
    assertIdle() {
      const required = queued.filter((run) => !run.optional).length;
      if (required > 0) {
        throw new Error(
          `${required} required process run${required === 1 ? " was" : "s were"} not consumed`,
        );
      }
      const running = owned.filter((process) => process.running).length;
      if (running > 0)
        throw new Error(`${running} running process${running === 1 ? "" : "es"} leaked`);
    },
    async [Symbol.asyncDispose]() {
      const required = queued.filter((run) => !run.optional).length;
      const running = owned.filter((process) => process.running);
      for (const process of running) {
        process.abortRequested = true;
        finish(process, { exitCode: null, signal: "SIGTERM" });
      }
      await Promise.all(owned.map((process) => process.result.promise));

      const diagnostics: string[] = [];
      if (required > 0) diagnostics.push(`${required} unconsumed required process run(s)`);
      if (running.length > 0) diagnostics.push(`${running.length} running process(es)`);
      if (diagnostics.length > 0) {
        throw new Error(`Fake process disposal found leaked resources: ${diagnostics.join(", ")}`);
      }
    },
  };
  return api;
}

function endStdout(process: OwnedProcess): void {
  if (process.stdoutEnded) return;
  process.stdoutEnded = true;
  process.stdout.end();
}

function copyInvocation(input: ChildProcessSpawnInput): ChildProcessSpawnInput {
  return {
    command: input.command,
    args: [...input.args],
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.env === undefined ? {} : { env: { ...input.env } }),
    ...(input.forceAfterMs === undefined ? {} : { forceAfterMs: input.forceAfterMs }),
  };
}

function getOrCreateCheckpoint(checkpoints: Map<string, Checkpoint>, name: string): Checkpoint {
  const existing = checkpoints.get(name);
  if (existing) return existing;
  const checkpoint: Checkpoint = {
    reached: deferred<void>(),
    released: deferred<void>(),
    isReached: false,
    isReleased: false,
  };
  checkpoints.set(name, checkpoint);
  return checkpoint;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value?: T) {
      resolvePromise?.(value as T);
    },
  };
}
