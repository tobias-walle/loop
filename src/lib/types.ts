/** A single task or a group of tasks with optional loop modifiers. */
export type Step =
  | {
      type: "task";
      task: string;
      until?: string;
      repeat?: number;
      max?: number;
    }
  | {
      type: "group";
      tasks: string[];
      until?: string;
      repeat?: number;
      max?: number;
    };

/** Configuration derived from CLI parsing. */
export type LoopConfig = {
  steps: Step[];
  command?: "init" | "help" | "version";
  agent?: "claude" | "pi";
  passthroughArgs?: string[];
};

/** Token usage counters. */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

/** Represents the current state of the pipeline during execution. */
export type PipelineState = {
  step: number;
  totalSteps: number;
  iteration: number;
  costUsd: number;
  currentSessionCostUsd: number;
  durationMs: number;
  startTime: number;
  usage: TokenUsage;
  currentSessionUsage: TokenUsage;
};

/** Context passed to the template renderer for a single iteration. */
export type TemplateContext = {
  task: string;
  step: number;
  totalSteps: number;
  iteration: number;
  max?: number;
  until?: string;
  repeat?: number;
  isGroup?: boolean;
  previousSummary?: string;
  previousIterationSummary?: string;
};

/** Result of running the entire pipeline. */
export type RunResult = {
  success: boolean;
  totalCostUsd: number;
  totalDurationMs: number;
  totalUsage: TokenUsage;
  stepResults: StepResult[];
};

/** Result of a single step execution. */
export type StepExitReason = "done" | "loop_done" | "max_reached" | "error";

export type SessionResult = {
  iteration: number;
  result: string;
  costUsd: number;
  durationMs: number;
  usage: TokenUsage;
  exitReason: StepExitReason;
  error?: string;
};

export type StepResult = {
  step: Step;
  iterations: number;
  result: string;
  costUsd: number;
  durationMs: number;
  usage: TokenUsage;
  exitReason: StepExitReason;
  error?: string;
};

/** Result of running the entire pipeline. */
export type RunSummary = {
  totalCostUsd: number;
  totalDurationMs: number;
  totalUsage: TokenUsage;
};
