import { renderTemplate } from "../template.js";
import type { Step, TemplateContext, TokenUsage } from "../types.js";

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export function buildPrompt(
  step: Step,
  template: string,
  stepIndex: number,
  totalSteps: number,
  iteration: number,
  previousSummary?: string,
  previousIterationSummary?: string,
): string {
  if (step.type === "task") {
    const context: TemplateContext = {
      task: step.task,
      step: stepIndex + 1,
      totalSteps,
      iteration,
      max: step.max,
      until: step.until,
      repeat: step.repeat,
      previousSummary,
      previousIterationSummary,
    };
    return renderTemplate(template, context);
  }

  // Group step: render each task and join
  const parts: string[] = [];
  for (const task of step.tasks) {
    const context: TemplateContext = {
      task,
      step: stepIndex + 1,
      totalSteps,
      iteration,
      max: step.max,
      until: step.until,
      repeat: step.repeat,
      isGroup: true,
      previousSummary,
      previousIterationSummary,
    };
    parts.push(renderTemplate(template, context));
  }
  return parts.join("\n");
}
