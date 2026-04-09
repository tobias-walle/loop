import * as fs from "node:fs";
import * as path from "node:path";
import type { TemplateContext } from "./types";

export const DEFAULT_TEMPLATE = `# Loop Context

You are running as part of an automated loop pipeline.

## Your Task
{{task}}

## Pipeline Position
Step {{step}} of {{totalSteps}}.

{{#if until}}
## Loop Instructions
You are in iteration {{iteration}}{{#if max}} of {{max}}{{/if}}.

Your exit condition is:
> {{until}}

After completing your work, you MUST evaluate the exit condition and end your
final message with one of these markers on its own line:

If the condition IS met:
\`\`\`
LOOP_DONE
\`\`\`

If the condition is NOT met:
\`\`\`
LOOP_CONTINUE: <one-line summary of what was done and what remains>
\`\`\`

Rules:
- Focus on a single task per iteration. Do not try to do everything at once.
- Be thorough in checking the exit condition. Do not claim it is met unless you
  have verified it.
- The marker MUST be the last line of your response.
{{/if}}

{{#if repeat}}
## Repeat Info
This is repetition {{iteration}} of {{repeat}}.
{{/if}}

{{#if previousSummary}}
## Previous Step
This is what happened in the previous step:
{{previousSummary}}
{{/if}}

{{#if previousIterationSummary}}
## Previous Iteration
This is what happened in the previous iteration of this step:
{{previousIterationSummary}}
{{/if}}
`;

/**
 * Render a template string by replacing placeholders and evaluating conditionals.
 *
 * - `{{placeholder}}` is replaced with the matching value from context.
 * - `{{#if var}}...{{/if}}` blocks are included only when `var` is truthy.
 * - Supports nested conditionals.
 * - Missing context values result in empty string replacement.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const contextRecord = context as Record<string, unknown>;

  // Process conditionals from innermost to outermost.
  // Match blocks that contain no nested {{#if}} to handle nesting correctly.
  let result = template;
  const ifPattern = /\{\{#if (\w+)\}\}((?:(?!\{\{#if )[\s\S])*?)\{\{\/if\}\}/;
  let match = ifPattern.exec(result);
  while (match !== null) {
    const varName = match[1];
    const content = match[2];
    const value = contextRecord[varName];
    const isTruthy = value !== undefined && value !== null && value !== "" && value !== 0;
    result =
      result.slice(0, match.index) +
      (isTruthy ? content : "") +
      result.slice(match.index + match[0].length);
    match = ifPattern.exec(result);
  }

  // Replace placeholders
  result = result.replace(/\{\{(\w+)\}\}/g, (_full, key: string) => {
    const value = contextRecord[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });

  return result;
}

/**
 * Load the LOOP.md template from the project root, falling back to the
 * built-in default shipped with the package.
 */
export function loadTemplate(projectRoot: string): {
  template: string;
  source: "user" | "default";
} {
  const userTemplate = path.join(projectRoot, "LOOP.md");
  try {
    return { template: fs.readFileSync(userTemplate, "utf-8"), source: "user" };
  } catch {
    return { template: DEFAULT_TEMPLATE, source: "default" };
  }
}
