import { type AgentArgs, mergeAgentArgs, renderAgentArgs } from "../../lib/agent-args.js";
import { type Logger, noopLogger } from "../../lib/logging.js";
import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "../types.js";
import {
  type ChildProcessHandle,
  childProcessFailure,
  type SpawnChildProcess,
  spawnChildProcessFromInput,
} from "../utils/child-process.js";
import { streamEvents } from "./stream.js";

const DEFAULT_CLAUDE_ARGS: AgentArgs = { "permission-mode": "auto" };
const PROCESS_NAME = "Claude process";

export interface ClaudeAdapterOptions {
  command?: string;
  model?: string;
  args?: AgentArgs;
  rawArgs?: string[];
  env?: Record<string, string>;
  logger?: Logger;
  spawnProcess?: SpawnChildProcess;
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): AgentAdapter {
  const logger = options?.logger ?? noopLogger;
  const command = options?.command ?? "claude";
  const configuredArgs = options?.args ?? {};
  const configuredRawArgs = options?.rawArgs ?? [];
  const configuredEnv = options?.env ?? {};
  const spawnProcess = options?.spawnProcess ?? spawnChildProcessFromInput;
  if (options?.model) {
    logger.warn(
      "Claude model config is currently ignored until Claude CLI model support is verified",
      { model: options.model },
    );
  }

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const args = [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        ...renderAgentArgs(mergeAgentArgs(DEFAULT_CLAUDE_ARGS, configuredArgs, opts?.args)),
        ...configuredRawArgs,
        prompt,
      ];
      logger.debug("Spawning Claude process", { command, cwd: opts?.cwd, argCount: args.length });
      const child = spawnProcess({
        command,
        args,
        cwd: opts?.cwd,
        env: { ...configuredEnv, ...(opts?.env ?? {}) },
      });
      logLifecycle(child, logger);

      return {
        events: streamClaudeSession(streamEvents(child.stdout), child, logger),
        exited: child.result.then(() => undefined),
        abort(): void {
          logger.warn("Aborting Claude process", { pid: child.pid });
          child.abort();
        },
      };
    },
  };
}

async function* streamClaudeSession(
  source: AsyncIterable<AgentEvent>,
  child: ChildProcessHandle,
  logger: Logger,
): AsyncGenerator<AgentEvent> {
  for await (const event of source) {
    if (event.type === "error") {
      child.abort();
      yield event;
      return;
    }
    if (event.type === "done") {
      const result = await child.result;
      const failure = childProcessFailure(PROCESS_NAME, result);
      if (failure) {
        logger.warn(failure, { pid: child.pid, code: result.exitCode, signal: result.signal });
        yield { type: "error", message: failure };
      } else yield event;
      return;
    }
    yield event;
  }

  const wasRunning = child.isRunning();
  if (wasRunning) child.abort();
  const result = await child.result;
  const failure =
    result.error || result.exitCode !== 0 || !wasRunning
      ? childProcessFailure(PROCESS_NAME, result)
      : undefined;
  const message = failure ?? "Claude event stream ended without completion";
  logger.warn(message, { pid: child.pid, exitCode: result.exitCode });
  yield { type: "error", message };
}

function logLifecycle(child: ChildProcessHandle, logger: Logger): void {
  if (child.pid == null) logger.warn("Claude process spawned without PID");
  else logger.info("Claude process spawned", { pid: child.pid });
  void child.result.then((result) => {
    logger.info("Claude process exited", {
      pid: child.pid,
      code: result.exitCode,
      signal: result.signal,
    });
  });
}
