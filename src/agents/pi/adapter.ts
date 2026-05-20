import { type ChildProcess, spawn } from "node:child_process";
import { type Logger, noopLogger } from "../../lib/logging.js";
import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "../types.js";
import { createPiEventState, mapPiEvent } from "./events.js";
import { readJsonLines, writeRpcCommand } from "./rpc.js";

export interface PiRpcAdapterOptions {
  command?: string;
  model?: string;
  args?: string[];
  env?: Record<string, string>;
  logger?: Logger;
}

export function createPiRpcAdapter(options: PiRpcAdapterOptions = {}): AgentAdapter {
  const command = options.command ?? "pi";
  const model = options.model;
  const configuredArgs = options.args ?? [];
  const configuredEnv = options.env ?? {};
  const logger = options.logger ?? noopLogger;

  if (configuredArgs.some((arg) => arg === "--mode" || arg.startsWith("--mode="))) {
    throw new Error('pi adapter does not allow "--mode" in args because it must enforce RPC mode');
  }

  const sessionArgs = configuredArgs.includes("--no-session") ? [] : ["--no-session"];

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const args = [
        ...(model ? ["--model", model] : []),
        ...configuredArgs,
        ...sessionArgs,
        "--mode",
        "rpc",
      ];
      logger.debug("Spawning pi RPC process", { command, cwd: opts?.cwd, argCount: args.length });

      const proc: ChildProcess = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: opts?.cwd,
        env: { ...process.env, ...configuredEnv, ...(opts?.env ?? {}) },
      });
      const pid = proc.pid;
      if (pid == null) logger.warn("pi RPC process spawned without PID");
      else logger.info("pi RPC process spawned", { pid });

      let stderrBuf = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        let idx = stderrBuf.indexOf("\n");
        while (idx !== -1) {
          const line = stderrBuf.slice(0, idx).trim();
          if (line) logger.warn("pi stderr", { pid, line });
          stderrBuf = stderrBuf.slice(idx + 1);
          idx = stderrBuf.indexOf("\n");
        }
      });
      proc.stderr?.on("end", () => {
        if (stderrBuf.trim()) logger.warn("pi stderr", { pid, line: stderrBuf.trim() });
      });
      proc.on("error", (err) => logger.error("pi RPC process error", { pid, error: err.message }));

      const exited = new Promise<void>((resolve) => {
        proc.on("exit", (code, signal) => {
          logger.info("pi RPC process exited", { pid, code, signal });
          if (proc.stdout && !proc.stdout.destroyed) proc.stdout.destroy();
          resolve();
        });
      });

      writeRpcCommand(proc.stdin, { type: "prompt", message: prompt });

      return {
        events: proc.stdout ? wrapPiEvents(proc.stdout, proc, logger, pid) : noStdout(),
        exited,
        sendMessage(text: string): void {
          writeRpcCommand(proc.stdin, { type: "steer", message: text });
          logger.debug("Sent steer message to pi", { pid, textLength: text.length });
        },
        abort(): void {
          writeRpcCommand(proc.stdin, { type: "abort" });
          logger.warn("Aborting pi RPC process", { pid });
          proc.kill("SIGTERM");
        },
      };
    },
  };
}

async function* wrapPiEvents(
  stdout: NodeJS.ReadableStream,
  proc: ChildProcess,
  logger: Logger,
  pid: number | undefined,
): AsyncGenerator<AgentEvent> {
  const state = createPiEventState();
  try {
    for await (const raw of readJsonLines(stdout as import("node:stream").Readable)) {
      const events = mapPiEvent(raw, state);
      for (const event of events) {
        yield event;
        if (event.type === "done" || event.type === "error") {
          logger.debug("Terminating pi RPC process after event", { pid, eventType: event.type });
          proc.stdin?.end();
          proc.kill("SIGTERM");
          return;
        }
      }
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  const exitCode = proc.exitCode;
  const message =
    exitCode != null
      ? `pi RPC process exited unexpectedly (code ${exitCode})`
      : "pi RPC stream ended without completion";
  logger.warn(message, { pid, exitCode });
  yield { type: "error", message };
}

async function* noStdout(): AsyncGenerator<AgentEvent> {
  yield { type: "error", message: "pi RPC process has no stdout stream" };
}
