import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadTemplate, renderTemplate } from "./template";
import type { TemplateContext } from "./types";

describe("renderTemplate", () => {
  test("replaces basic placeholders", () => {
    const template = "Task: {{task}}, Step {{step}} of {{totalSteps}}";
    const context: TemplateContext = {
      task: "Fix bugs",
      step: 2,
      totalSteps: 5,
      iteration: 1,
    };
    expect(renderTemplate(template, context)).toBe("Task: Fix bugs, Step 2 of 5");
  });

  test("replaces all available placeholders", () => {
    const template =
      "{{task}} {{step}} {{totalSteps}} {{iteration}} {{max}} {{until}} {{repeat}} {{previousSummary}} {{previousIterationSummary}}";
    const context: TemplateContext = {
      task: "Do stuff",
      step: 3,
      totalSteps: 10,
      iteration: 2,
      max: 5,
      until: "all done",
      repeat: 3,
      previousSummary: "prev step",
      previousIterationSummary: "prev iter",
    };
    expect(renderTemplate(template, context)).toBe(
      "Do stuff 3 10 2 5 all done 3 prev step prev iter",
    );
  });

  test("replaces missing context values with empty string", () => {
    const template = "before {{until}} after";
    const context: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
    };
    expect(renderTemplate(template, context)).toBe("before  after");
  });

  test("includes conditional block when var is truthy string", () => {
    const template = "{{#if until}}Condition: {{until}}{{/if}}";
    const context: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
      until: "tests pass",
    };
    expect(renderTemplate(template, context)).toBe("Condition: tests pass");
  });

  test("includes conditional block when var is truthy number", () => {
    const template = "{{#if max}}Max: {{max}}{{/if}}";
    const context: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
      max: 10,
    };
    expect(renderTemplate(template, context)).toBe("Max: 10");
  });

  test("excludes conditional block when var is undefined", () => {
    const template = "before{{#if until}}HIDDEN{{/if}}after";
    const context: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
    };
    expect(renderTemplate(template, context)).toBe("beforeafter");
  });

  test("excludes conditional block when var is empty string", () => {
    const template = "before{{#if until}}HIDDEN{{/if}}after";
    const context: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
      until: "",
    };
    expect(renderTemplate(template, context)).toBe("beforeafter");
  });

  test("handles nested conditionals", () => {
    const template = "{{#if until}}outer{{#if max}} inner{{/if}} end{{/if}}";
    const withBoth: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
      until: "done",
      max: 5,
    };
    expect(renderTemplate(template, withBoth)).toBe("outer inner end");

    const outerOnly: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
      until: "done",
    };
    expect(renderTemplate(template, outerOnly)).toBe("outer end");

    const neither: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
    };
    expect(renderTemplate(template, neither)).toBe("");
  });

  test("renders full template with all placeholders filled", () => {
    const template = `# Task: {{task}}
Step {{step}}/{{totalSteps}}, iteration {{iteration}}
{{#if until}}Until: {{until}}{{#if max}} (max {{max}}){{/if}}{{/if}}
{{#if repeat}}Repeat: {{iteration}}/{{repeat}}{{/if}}
{{#if previousSummary}}Prev: {{previousSummary}}{{/if}}
{{#if previousIterationSummary}}PrevIter: {{previousIterationSummary}}{{/if}}`;

    const context: TemplateContext = {
      task: "Deploy",
      step: 2,
      totalSteps: 4,
      iteration: 3,
      until: "all green",
      max: 10,
      previousSummary: "Built successfully",
      previousIterationSummary: "Fixed 2 tests",
    };

    const rendered = renderTemplate(template, context);
    expect(rendered).toContain("# Task: Deploy");
    expect(rendered).toContain("Step 2/4, iteration 3");
    expect(rendered).toContain("Until: all green (max 10)");
    expect(rendered).not.toContain("Repeat:");
    expect(rendered).toContain("Prev: Built successfully");
    expect(rendered).toContain("PrevIter: Fixed 2 tests");
  });

  test("renders template with minimal context", () => {
    const template = `{{task}} - {{step}}/{{totalSteps}} iter {{iteration}}
{{#if until}}UNTIL{{/if}}{{#if repeat}}REPEAT{{/if}}{{#if previousSummary}}PREV{{/if}}`;

    const context: TemplateContext = {
      task: "Run tests",
      step: 1,
      totalSteps: 1,
      iteration: 1,
    };

    const rendered = renderTemplate(template, context);
    expect(rendered).toBe("Run tests - 1/1 iter 1\n");
  });

  test("handles isGroup conditional", () => {
    const template = "{{#if isGroup}}grouped{{/if}}";
    const withGroup: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
      isGroup: true,
    };
    expect(renderTemplate(template, withGroup)).toBe("grouped");

    const withoutGroup: TemplateContext = {
      task: "t",
      step: 1,
      totalSteps: 1,
      iteration: 1,
    };
    expect(renderTemplate(template, withoutGroup)).toBe("");
  });
});

describe("loadTemplate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loads .loop/LOOP.md when it exists", () => {
    const customTemplate = "# Custom\n{{task}}";
    fs.mkdirSync(path.join(tmpDir, ".loop"));
    fs.writeFileSync(path.join(tmpDir, ".loop", "LOOP.md"), customTemplate);

    const result = loadTemplate(tmpDir);
    expect(result.template).toBe(customTemplate);
    expect(result.source).toBe("user");
  });

  test("falls back to built-in default when .loop/LOOP.md is missing", () => {
    const result = loadTemplate(tmpDir);
    expect(result.template).toContain("# Loop Context");
    expect(result.template).toContain("{{task}}");
    expect(result.template).toContain("{{#if until}}");
    expect(result.template).toContain("LOOP_DONE");
    expect(result.source).toBe("default");
  });
});

describe("default template", () => {
  let defaultTemplate: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-default-"));
    defaultTemplate = loadTemplate(tmpDir).template;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("renders correctly for a simple single task", () => {
    const context: TemplateContext = {
      task: "Create an about page",
      step: 1,
      totalSteps: 1,
      iteration: 1,
    };
    const rendered = renderTemplate(defaultTemplate, context);
    expect(rendered).toContain("Create an about page");
    expect(rendered).toContain("Step 1 of 1");
    expect(rendered).not.toContain("Loop Instructions");
    expect(rendered).not.toContain("Repeat Info");
    expect(rendered).not.toContain("Previous Step");
    expect(rendered).not.toContain("Previous Iteration");
  });

  test("renders correctly for an until loop with max", () => {
    const context: TemplateContext = {
      task: "Fix failing tests",
      step: 2,
      totalSteps: 3,
      iteration: 3,
      until: "All tests pass",
      max: 10,
      previousSummary: "Set up the project",
    };
    const rendered = renderTemplate(defaultTemplate, context);
    expect(rendered).toContain("Fix failing tests");
    expect(rendered).toContain("Step 2 of 3");
    expect(rendered).toContain("iteration 3 of 10");
    expect(rendered).toContain("All tests pass");
    expect(rendered).toContain("LOOP_DONE");
    expect(rendered).toContain("LOOP_CONTINUE");
    expect(rendered).toContain("Set up the project");
    expect(rendered).not.toContain("Repeat Info");
  });

  test("renders correctly for a repeat loop", () => {
    const context: TemplateContext = {
      task: "Run linter",
      step: 1,
      totalSteps: 1,
      iteration: 2,
      repeat: 3,
    };
    const rendered = renderTemplate(defaultTemplate, context);
    expect(rendered).toContain("Run linter");
    expect(rendered).toContain("repetition 2 of 3");
    expect(rendered).not.toContain("Loop Instructions");
  });

  test("renders correctly with previous iteration summary", () => {
    const context: TemplateContext = {
      task: "Review code",
      step: 1,
      totalSteps: 2,
      iteration: 2,
      until: "No issues found",
      previousIterationSummary: "Found 3 issues, fixed 1",
    };
    const rendered = renderTemplate(defaultTemplate, context);
    expect(rendered).toContain("Found 3 issues, fixed 1");
    expect(rendered).toContain("Previous Iteration");
  });
});
