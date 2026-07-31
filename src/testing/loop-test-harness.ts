import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLoopApplication } from "../commands/application.js";
import { executeSession } from "../commands/execute-session.js";
import { createRunReporter } from "../commands/run-reporter.js";
import type { AgentName } from "../lib/config/index.js";
import type { SessionEvent } from "../lib/session-event.js";
import { readSessionLock } from "../lib/session-lock.js";
import { discoverSessions, loadSession, type SessionRecord } from "../lib/session-store.js";
import {
  getProjectConfigPath,
  getProjectRecipesDir,
  getProjectTemplatePath,
} from "../lib/storage-paths.js";
import type { LoopConfig, Step } from "../lib/types.js";
import type { RunOutput } from "../output/run-reporter.js";
import type { BrowseSessionsOptions } from "../tui/session-browser/index.js";
import { type ClaudeScenarioBuilder, createClaudeScenario } from "./claude-scenario.js";
import {
  createFakeProcessSpawner,
  type FakeProcessRun,
  type FakeProcessSpawner,
} from "./fake-process.js";
import { createPiScenario, type PiScenarioBuilder } from "./pi-scenario.js";

export interface LoopTestRoots {
  owner: string;
  project: string;
  config: string;
  state: string;
}

export interface HarnessRunOptions {
  agent?: AgentName;
  repeat?: number;
  until?: string;
  max?: number;
}

export interface HarnessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  session?: SessionRecord;
}

export interface ProviderHarness<Builder> {
  givenRun(configure: (scenario: Builder) => Builder | undefined): void;
  givenRawRun(run: FakeProcessRun): void;
  invocations(): ReturnType<FakeProcessSpawner["invocations"]>;
  processes(): ReturnType<FakeProcessSpawner["processes"]>;
  waitForCheckpoint(name: string): Promise<void>;
  releaseCheckpoint(name: string): void;
}

export type AgentScenario<Name extends AgentName> = Name extends "pi"
  ? PiScenarioBuilder
  : ClaudeScenarioBuilder;

export interface LoopTestHarness {
  readonly roots: LoopTestRoots;
  readonly env: NodeJS.ProcessEnv;
  agent<Name extends AgentName>(name: Name): ProviderHarness<AgentScenario<Name>>;
  readonly session: {
    all(): SessionRecord[];
    latest(): SessionRecord | undefined;
    events(): SessionEvent[];
    lock(): ReturnType<typeof readSessionLock>;
  };
  run(task: string, options?: HarnessRunOptions): Promise<HarnessRunResult>;
  runSteps(steps: Step[], options?: Pick<HarnessRunOptions, "agent">): Promise<HarnessRunResult>;
  runRecipe(name: string, args?: string[]): Promise<HarnessRunResult>;
  resume(sessionDir?: string): Promise<HarnessRunResult>;
  interrupt(): void;
  writeConfig(toml: string): void;
  writeTemplate(template: string): void;
  writeRecipe(name: string, yaml: string): void;
  stdout(): string;
  stderr(): string;
  resources(): { queuedRuns: number; runningProcesses: number; locks: number };
  diagnostics(): string;
  [Symbol.asyncDispose](): Promise<void>;
}

export async function setupLoopTest(
  options: { env?: Record<string, string> } = {},
): Promise<LoopTestHarness> {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), "loop-harness-"));
  const roots: LoopTestRoots = {
    owner,
    project: path.join(owner, "project"),
    config: path.join(owner, "config"),
    state: path.join(owner, "state"),
  };
  fs.mkdirSync(roots.project, { recursive: true });
  fs.mkdirSync(roots.config, { recursive: true });
  fs.mkdirSync(roots.state, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    LOOP_CONFIG_HOME: roots.config,
    LOOP_STATE_HOME: roots.state,
  };
  const outputChunks: string[] = [];
  const errorChunks: string[] = [];
  const output: RunOutput = {
    isTTY: false,
    write(text) {
      outputChunks.push(text);
    },
  };
  const piProcess = createFakeProcessSpawner();
  const claudeProcess = createFakeProcessSpawner();
  let activeController: AbortController | undefined;
  let resumeTarget: string | undefined;
  let disposed = false;

  const browseSessions = async (browser: BrowseSessionsOptions) => {
    const selected = resumeTarget
      ? browser.sessions.find((session) => session.sessionDir === resumeTarget)
      : browser.sessions[0];
    return selected
      ? { type: "resume" as const, session: selected }
      : { type: "exit" as const, exitCode: 1 };
  };
  const application = createLoopApplication({
    projectRoot: roots.project,
    env,
    spawnProcess(input) {
      if (input.command === "pi") return piProcess.spawn(input);
      if (input.command === "claude") return claudeProcess.spawn(input);
      throw new Error(`Harness has no provider process for command "${input.command}"`);
    },
    createRunReporter,
    browseSessions,
    executeSession,
  });

  const runConfig = async (config: LoopConfig): Promise<HarnessRunResult> => {
    ensureActive();
    const stdoutStart = outputChunks.length;
    const stderrStart = errorChunks.length;
    const controller = new AbortController();
    activeController = controller;
    try {
      const exitCode = await application.run(config, {
        stdout: output,
        signal: controller.signal,
        writeError(message) {
          errorChunks.push(`${message}\n`);
        },
      });
      return result(exitCode, stdoutStart, stderrStart);
    } finally {
      if (activeController === controller) activeController = undefined;
    }
  };

  const provider = <Builder>(
    process: FakeProcessSpawner,
    factory: () => Builder,
    build: (builder: Builder) => FakeProcessRun,
  ): ProviderHarness<Builder> => ({
    givenRun(configure) {
      const scenario = factory();
      process.givenRun(build(configure(scenario) ?? scenario));
    },
    givenRawRun: (run) => process.givenRun(run),
    invocations: process.invocations,
    processes: process.processes,
    waitForCheckpoint: process.waitForCheckpoint,
    releaseCheckpoint: process.releaseCheckpoint,
  });

  const piProvider = provider(piProcess, createPiScenario, (scenario) => scenario.build());
  const claudeProvider = provider(claudeProcess, createClaudeScenario, (scenario) =>
    scenario.build(),
  );

  const api: LoopTestHarness = {
    roots,
    env,
    agent<Name extends AgentName>(name: Name): ProviderHarness<AgentScenario<Name>> {
      return (name === "pi" ? piProvider : claudeProvider) as ProviderHarness<AgentScenario<Name>>;
    },
    session: {
      all: sessions,
      latest: () => sessions()[0],
      events: () => sessions()[0]?.events ?? [],
      lock: () => {
        const latest = sessions()[0];
        return latest ? readSessionLock(latest.sessionDir) : { health: "unlocked" };
      },
    },
    run(task, runOptions = {}) {
      const step: Step = {
        type: "task",
        task,
        ...(runOptions.repeat === undefined ? {} : { repeat: runOptions.repeat }),
        ...(runOptions.until === undefined ? {} : { until: runOptions.until }),
        ...(runOptions.max === undefined ? {} : { max: runOptions.max }),
      };
      return runConfig({ steps: [step], agent: runOptions.agent });
    },
    runSteps: (steps, runOptions = {}) => runConfig({ steps, agent: runOptions.agent }),
    runRecipe: (name, args = []) =>
      runConfig({ steps: [], recipe: { name, args }, command: undefined }),
    async resume(sessionDir) {
      ensureActive();
      const stdoutStart = outputChunks.length;
      const stderrStart = errorChunks.length;
      resumeTarget = sessionDir;
      const controller = new AbortController();
      activeController = controller;
      try {
        const exitCode = await application.resume({
          stdout: output,
          signal: controller.signal,
          writeError(message) {
            errorChunks.push(`${message}\n`);
          },
        });
        return result(exitCode, stdoutStart, stderrStart);
      } finally {
        resumeTarget = undefined;
        if (activeController === controller) activeController = undefined;
      }
    },
    interrupt() {
      activeController?.abort();
    },
    writeConfig(toml) {
      writeProjectFile(getProjectConfigPath(roots.project), toml);
    },
    writeTemplate(template) {
      writeProjectFile(getProjectTemplatePath(roots.project), template);
    },
    writeRecipe(name, yaml) {
      writeProjectFile(path.join(getProjectRecipesDir(roots.project), `${name}.yaml`), yaml);
    },
    stdout: () => outputChunks.join(""),
    stderr: () => errorChunks.join(""),
    resources,
    diagnostics: () =>
      JSON.stringify(
        {
          roots,
          resources: resources(),
          piInvocations: piProcess.invocations(),
          claudeInvocations: claudeProcess.invocations(),
          session: sessions()[0]?.aggregate,
          stdout: outputChunks.join(""),
          stderr: errorChunks.join(""),
        },
        mapValues,
        2,
      ),
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      activeController?.abort();
      const failures: string[] = [];
      for (const process of [piProcess, claudeProcess]) {
        try {
          await process[Symbol.asyncDispose]();
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      const diagnostics = failures.length > 0 ? api.diagnostics() : undefined;
      fs.rmSync(owner, { recursive: true, force: true });
      if (failures.length > 0) {
        throw new Error(`Loop test harness cleanup failed: ${failures.join("; ")}\n${diagnostics}`);
      }
    },
  };
  return api;

  function sessions(): SessionRecord[] {
    return discoverSessions(env, roots.project).map((session) => loadSession(session.sessionDir));
  }

  function resources(): { queuedRuns: number; runningProcesses: number; locks: number } {
    const pi = piProcess.resources();
    const claude = claudeProcess.resources();
    return {
      queuedRuns: pi.queuedRuns + claude.queuedRuns,
      runningProcesses: pi.runningProcesses + claude.runningProcesses,
      locks: sessions().filter(
        (session) => readSessionLock(session.sessionDir).health !== "unlocked",
      ).length,
    };
  }

  function result(exitCode: number, stdoutStart: number, stderrStart: number): HarnessRunResult {
    return {
      exitCode,
      stdout: outputChunks.slice(stdoutStart).join(""),
      stderr: errorChunks.slice(stderrStart).join(""),
      session: sessions()[0],
    };
  }

  function ensureActive(): void {
    if (disposed) throw new Error("Loop test harness is disposed");
    if (activeController) throw new Error("Loop test harness already has a running workflow");
  }
}

function writeProjectFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

function mapValues(_key: string, value: unknown): unknown {
  return value instanceof Map ? Object.fromEntries(value) : value;
}
