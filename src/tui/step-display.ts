import type { Step } from "../lib/types.js";

export type StepDisplay = {
  task: string;
  isLoop: boolean;
  max?: number;
};

export function describeStep(step: Step): StepDisplay {
  const isLoop = step.until != null || (step.repeat != null && step.repeat > 1);
  return {
    task: step.type === "task" ? step.task : step.tasks.join(", "),
    isLoop,
    max: step.max ?? (step.repeat != null && step.repeat > 1 ? step.repeat : undefined),
  };
}
