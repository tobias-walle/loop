import { type ChildProcess, spawn } from "node:child_process";
import type { AgentAdapter, AgentSession, AgentSpawnOptions } from "../types.js";
import { generateInteractiveEvents, streamEvents } from "./stream.js";

export interface ClaudeAdapterOptions {
  interactive?: boolean;
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): AgentAdapter {
  const interactive = options?.interactive ?? false;

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const baseArgs = [
        "--verbose",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ];

      const args = interactive
        ? [...baseArgs, "--input-format", "stream-json"]
        : ["--print", ...baseArgs, prompt];

      const proc: ChildProcess = spawn("claude", args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
      });

      if (interactive) {
        const initMessage = JSON.stringify({
          type: "user",
          message: { role: "user", content: prompt },
        });
        proc.stdin?.write(`${initMessage}\n`);
      }

      const sentMessages: string[] = [];

      function writeUserMessage(text: string): void {
        const msg = JSON.stringify({
          type: "user",
          message: { role: "user", content: text },
        });
        proc.stdin?.write(`${msg}\n`);
        sentMessages.push(text);
      }

      const events =
        interactive && proc.stdout
          ? wrapTerminateOnEnd(generateInteractiveEvents(proc.stdout, sentMessages), proc)
          : proc.stdout
            ? wrapTerminateOnEnd(streamEvents(proc.stdout), proc)
            : emptyEvents();

      return {
        events,

        sendMessage(text: string): void {
          if (!interactive) return;
          writeUserMessage(text);
        },

        abort(): void {
          proc.kill("SIGTERM");
        },
      };
    },
  };
}

async function* wrapTerminateOnEnd(
  source: AsyncGenerator<import("../types.js").AgentEvent>,
  proc: ChildProcess,
): AsyncGenerator<import("../types.js").AgentEvent> {
  for await (const event of source) {
    yield event;
    if (event.type === "done" || event.type === "error") {
      proc.stdin?.end();
      proc.kill("SIGTERM");
      return;
    }
  }
}

async function* emptyEvents(): AsyncGenerator<import("../types.js").AgentEvent> {
  // No stdout, yield nothing
}
