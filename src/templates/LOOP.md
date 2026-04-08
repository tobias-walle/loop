# Loop Context

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
```
LOOP_DONE
```

If the condition is NOT met:
```
LOOP_CONTINUE: <one-line summary of what was done and what remains>
```

Rules:
- Focus on a single task per iteration. Do not try to do everything at once.
- Be thorough in checking the exit condition. Do not claim it is met unless you
  have verified it.
- The marker MUST be the last line of your response.
{{/if}}

{{#if repeat}}
## Repeat Info
This is repetition {{iteration}} of {{repeat}}.
Do NOT output LOOP_DONE or LOOP_CONTINUE markers. Those are only for --until loops.
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
