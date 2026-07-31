import {
  type SpawnChildProcess,
  spawnChildProcessFromInput,
} from "../agents/utils/child-process.js";
import type { LoopConfig } from "../lib/types.js";
import { browseSessions } from "../tui/session-browser/index.js";
import { executeSession } from "./execute-session.js";
import { type ResumeCommandIO, resumeCommand } from "./resume-command.js";
import { type RunCommandIO, runCommand } from "./run-command.js";
import { createRunReporter } from "./run-reporter.js";

export interface ApplicationDependencies {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  spawnProcess: SpawnChildProcess;
  createRunReporter: typeof createRunReporter;
  browseSessions: typeof browseSessions;
  executeSession: typeof executeSession;
}

export interface LoopApplication {
  run(config: LoopConfig, io: RunCommandIO): Promise<number>;
  resume(io: ResumeCommandIO): Promise<number>;
}

export function createLoopApplication(dependencies: ApplicationDependencies): LoopApplication {
  return {
    run: (config, io) => runCommand(config, io, dependencies),
    resume: (io) => resumeCommand(io, dependencies),
  };
}

export function createProductionApplication(
  options: { projectRoot?: string; env?: NodeJS.ProcessEnv; spawnProcess?: SpawnChildProcess } = {},
): LoopApplication {
  return createLoopApplication({
    projectRoot: options.projectRoot ?? process.cwd(),
    env: options.env ?? process.env,
    spawnProcess: options.spawnProcess ?? spawnChildProcessFromInput,
    createRunReporter,
    browseSessions,
    executeSession,
  });
}
