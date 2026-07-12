import { describe, expect, test } from "bun:test";
import { Container } from "@mariozechner/pi-tui";
import { createStubAdapter } from "../agents/stub.js";
import { PARALLEL_SUBAGENTS } from "../testing/scenarios/tools.js";
import { createEventRouter } from "./app.js";
import { PipeBox } from "./components/pipe-box.js";
import { ThinkingIndicator } from "./components/thinking-indicator.js";
import { ROOT_KEY } from "./event-handlers.js";

function setup() {
  const root = new Container();
  let renderCount = 0;
  const router = createEventRouter(root, () => {
    renderCount++;
  });
  return { root, router, getRenderCount: () => renderCount };
}

function renderChild(container: Container, index: number): string {
  return container.children[index].render(200).join("\n");
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("createEventRouter", () => {
  test("text_delta creates and updates a text component", () => {
    const { root, router } = setup();

    router.handleEvent({ type: "text_delta", text: "Hello", parentToolUseId: null }, 0);

    expect(root.children).toHaveLength(1);
    expect(router.state.textBlocks.get(ROOT_KEY)?.accumulated).toBe("Hello");

    router.handleEvent({ type: "text_delta", text: " world", parentToolUseId: null }, 0);

    expect(root.children).toHaveLength(1);
    expect(router.state.textBlocks.get(ROOT_KEY)?.accumulated).toBe("Hello world");
  });

  test("text_delta indents follow-up response lines", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "text_delta",
        text: "Added `REPORT.md`.\n\nNote: unrelated changes remain.",
        parentToolUseId: null,
      },
      0,
    );

    const rendered = renderChild(root, 0);
    expect(rendered).toContain("›");
    expect(rendered).toContain("Added `REPORT.md`.");
    expect(rendered).toContain("\n  Note: unrelated changes remain.");
  });

  test("text_done clears the text reference", () => {
    const { router } = setup();

    router.handleEvent({ type: "text_delta", text: "Hello", parentToolUseId: null }, 0);
    expect(router.state.textBlocks.has(ROOT_KEY)).toBe(true);

    router.handleEvent({ type: "text_done", text: "Hello", parentToolUseId: null }, 0);
    expect(router.state.textBlocks.has(ROOT_KEY)).toBe(false);
  });

  test("multiple text blocks are separate components", () => {
    const { root, router } = setup();

    router.handleEvent({ type: "text_delta", text: "First", parentToolUseId: null }, 0);
    router.handleEvent({ type: "text_done", text: "First", parentToolUseId: null }, 0);

    router.handleEvent({ type: "text_delta", text: "Second", parentToolUseId: null }, 0);
    router.handleEvent({ type: "text_done", text: "Second", parentToolUseId: null }, 0);

    // 2 text blocks + 1 thinking indicator (re-shown after last text_done)
    const nonThinking = root.children.filter((c) => !(c instanceof ThinkingIndicator));
    expect(nonThinking).toHaveLength(2);
  });

  test("tool_start adds a formatted line with no padding", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Read",
        input: { file_path: "src/index.ts" },
        parentToolUseId: null,
      },
      0,
    );

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("◇");
    expect(rendered).toContain("read");
    expect(rendered).toContain("src/index.ts");
  });

  test("task_started is a no-op when tool_start already created the container", () => {
    const { root, router } = setup();

    // tool_start creates the PipeBox (header is part of the box)
    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Agent",
        input: { description: "Review code" },
        parentToolUseId: null,
      },
      0,
    );
    expect(root.children).toHaveLength(1);

    // task_started should not add anything
    router.handleEvent(
      {
        type: "task_started",
        taskId: "task_1",
        toolUseId: "t1",
        description: "Review code",
        prompt: "Review",
      },
      0,
    );
    expect(root.children).toHaveLength(1);
    expect(router.state.toolIdToContainer.has("t1")).toBe(true);
  });

  test("task_started creates container as fallback when no preceding tool_start", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "task_started",
        taskId: "task_1",
        toolUseId: "t1",
        description: "Review code",
        prompt: "Review",
      },
      0,
    );

    // Single PipeBox with header
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBeInstanceOf(PipeBox);
    expect(router.state.toolIdToContainer.has("t1")).toBe(true);
  });

  test("tool_start for Agent creates nested container with model info", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Agent",
        input: { description: "Review code", model: "claude-haiku-4-5" },
        parentToolUseId: null,
      },
      0,
    );

    // Single PipeBox with header containing agent info
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBeInstanceOf(PipeBox);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("agent  Review code");
    expect(rendered).toContain("claude-haiku-4-5");
  });

  test("events with parentToolUseId route to subagent container", () => {
    const { root, router } = setup();

    // task_started creates the PipeBox and adds a thinking indicator inside
    router.handleEvent(
      {
        type: "task_started",
        taskId: "task_1",
        toolUseId: "t1",
        description: "Review code",
        prompt: "Review",
      },
      0,
    );

    const subBox = root.children[0] as PipeBox;
    expect(subBox.children).toHaveLength(1); // thinking indicator
    expect(subBox.children[0]).toBeInstanceOf(ThinkingIndicator);

    // text_delta removes the thinking indicator and adds text
    router.handleEvent({ type: "text_delta", text: "Reviewing...", parentToolUseId: "t1" }, 0);
    expect(subBox.children).toHaveLength(1); // text only

    // text_done re-shows thinking indicator
    router.handleEvent({ type: "text_done", text: "Reviewing...", parentToolUseId: "t1" }, 0);

    // tool_start removes thinking and adds tool line
    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t2",
        tool: "Read",
        input: { file_path: "src/app.ts" },
        parentToolUseId: "t1",
      },
      0,
    );
    expect(subBox.children).toHaveLength(2); // text + tool line
  });

  test("task_done sets footer on PipeBox with summary", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "task_started",
        taskId: "task_1",
        toolUseId: "t1",
        description: "Review",
        prompt: "Review code",
      },
      0,
    );
    expect(router.state.toolIdToContainer.has("t1")).toBe(true);

    router.handleEvent(
      {
        type: "task_done",
        taskId: "task_1",
        toolUseId: "t1",
        status: "completed",
        summary: "Review finished",
        durationMs: 3000,
        model: "claude-haiku-4-5",
        totalTokens: 16934,
      },
      0,
    );
    expect(router.state.toolIdToContainer.has("t1")).toBe(false);

    // The └ line is the PipeBox footer, rendered as part of the box
    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("└");
    expect(rendered).toContain("completed");
    expect(rendered).toContain("Review finished");
    expect(rendered).toContain("3.0s");
  });

  test("tool_done re-shows thinking indicator", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Read",
        input: { file_path: "x.ts" },
        parentToolUseId: null,
      },
      0,
    );
    expect(root.children).toHaveLength(1); // tool line

    router.handleEvent(
      { type: "tool_done", toolId: "t1", result: "content", parentToolUseId: null },
      0,
    );
    // tool line + thinking indicator
    expect(root.children).toHaveLength(2);
    expect(root.children[1]).toBeInstanceOf(ThinkingIndicator);
  });

  test("retry event adds message", () => {
    const { root, router } = setup();

    router.handleEvent(
      { type: "retry", attempt: 1, maxRetries: 10, delayMs: 500, error: "rate_limit" },
      0,
    );

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("↻");
    expect(rendered).toContain("retry");
    expect(rendered).toContain("1/10");
  });

  test("error event adds message", () => {
    const { root, router } = setup();

    router.handleEvent({ type: "error", message: "Something broke" }, 0);

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("✕");
    expect(rendered).toContain("error");
    expect(rendered).toContain("Something broke");
  });

  test("showStepHeader adds header", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 3, "Create an about page");

    // 1 blank line + 2 header lines + blank line + waiting indicator = 5
    expect(root.children).toHaveLength(5);
    const meta = renderChild(root, 1);
    const task = renderChild(root, 2);
    expect(meta).toContain("[step 01/03]");
    expect(task).not.toContain("•");
    expect(task).toContain("Create an about page");
    expect(renderChild(root, 3).trim()).toBe("");
    expect(root.children[4]).toBeInstanceOf(ThinkingIndicator);
    expect(renderChild(root, 4)).toContain("waiting");
  });

  test("showStepHeader adds gap before second header", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 3, "First");
    router.showStepHeader(2, 3, "Second");

    // First header remains, first spinner is removed, then the second header and spinner are added.
    expect(root.children).toHaveLength(9);
  });

  test("showStepHeader with iteration info", () => {
    const { root, router } = setup();

    router.showStepHeader(2, 3, "Review code", 3, 10);

    const rendered = renderChild(root, 1);
    expect(rendered).toContain("iter 03/10");
  });

  test("session_start updates the active step header with model info", () => {
    const { root, router, getRenderCount } = setup();

    router.showStepHeader(1, 2, "Write code");
    router.handleEvent({ type: "session_start", model: "pi", sessionId: "s1", tools: ["Bash"] }, 0);
    router.handleEvent(
      { type: "session_start", model: "gpt-5.5", sessionId: "s1", tools: ["Bash"] },
      0,
    );

    const rendered = renderChild(root, 1);
    expect(rendered).toContain("[step 01/02 · gpt-5.5]");
    expect(getRenderCount()).toBeGreaterThan(1);
  });

  test("showStepHeader renders concise agent args", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 2, "Write code", undefined, undefined, undefined, "claude", {
      "permission-mode": "bypassPermissions",
    });

    const rendered = renderChild(root, 1);
    expect(rendered).toContain("claude");
    expect(rendered).toContain("permission-mode=bypassPermissions");
  });

  test("session_start preserves agent args in the active step header", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 2, "Write code", undefined, undefined, undefined, "claude", {
      "permission-mode": "bypassPermissions",
    });
    router.handleEvent(
      { type: "session_start", model: "claude-sonnet", sessionId: "s1", tools: ["Bash"] },
      0,
    );

    const rendered = renderChild(root, 1);
    expect(rendered).toContain("claude");
    expect(rendered).toContain("permission-mode=bypassPermissions");
    expect(rendered).toContain("claude-sonnet");
  });

  test("thinking indicator is removed on first agent output and re-shown after text_done", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 1, "Do stuff");

    // spacer + 2 header lines + blank line + waiting indicator = 5
    expect(root.children).toHaveLength(5);
    expect(router.state.thinkingIndicators.get(ROOT_KEY)).toBeDefined();

    router.handleEvent({ type: "text_delta", text: "Hi", parentToolUseId: null }, 0);

    // waiting indicator is removed while visible text is streaming
    expect(root.children).toHaveLength(5);
    expect(router.state.thinkingIndicators.get(ROOT_KEY)).toBeUndefined();
    expect(root.children.some((c) => c instanceof ThinkingIndicator)).toBe(false);

    // After text_done, a thinking indicator re-appears while the response can continue.
    router.handleEvent({ type: "text_done", text: "Hi", parentToolUseId: null }, 0);
    expect(root.children).toHaveLength(6); // spacer + header lines + blank line + text + thinking
    expect(router.state.thinkingIndicators.get(ROOT_KEY)).toBeDefined();
    expect(root.children.some((c) => c instanceof ThinkingIndicator)).toBe(true);
    expect(renderChild(root, 5)).toContain("thinking");
  });

  test("showCompletion adds marker", () => {
    const { root, router } = setup();

    router.showCompletion("done", 83000);
    expect(root.children).toHaveLength(4);
    expect(renderChild(root, 0).trim()).toBe("");
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("✓");
    expect(rendered).toContain("done");
    expect(rendered).toContain("1m 23s");
    expect(renderChild(root, 2).trim()).toBe("");
    const separator = stripAnsi(renderChild(root, 3));
    expect(separator).toContain("─");
    expect(separator.trim()).toHaveLength(200);
  });

  test("showCompletion loop_done with iterations", () => {
    const { root, router } = setup();

    router.showCompletion("loop_done", 221000, 2);
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("✓");
    expect(rendered).toContain("done");
    expect(rendered).toContain("2 iterations");
  });

  test("showCompletion max_reached", () => {
    const { root, router } = setup();

    router.showCompletion("max_reached", 60000, 10);
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("▲");
    expect(rendered).toContain("max");
    expect(rendered).toContain("10 iterations");
  });

  test("showRunSummary keeps balanced separator spacing before loop summary", () => {
    const { root, router } = setup();

    router.showCompletion("done", 1000);
    router.showRunSummary({
      totalCostUsd: 0.01,
      totalDurationMs: 1000,
      totalUsage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });

    expect(root.children).toHaveLength(6);
    expect(renderChild(root, 2).trim()).toBe("");
    expect(renderChild(root, 3)).toContain("─");
    expect(renderChild(root, 4).trim()).toBe("");
    expect(renderChild(root, 5)).toContain("✓");
    expect(renderChild(root, 5)).toContain("loop");
  });

  test("session_start and done events produce no output", () => {
    const { root, router } = setup();

    router.handleEvent(
      { type: "session_start", model: "claude-sonnet", sessionId: "s1", tools: ["Bash"] },
      0,
    );
    router.handleEvent(
      {
        type: "done",
        result: "All done",
        costUsd: 0.01,
        durationMs: 5000,
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      0,
    );

    expect(root.children).toHaveLength(0);
  });

  test("requestRender is called on visual events", () => {
    const { router, getRenderCount } = setup();

    router.handleEvent({ type: "text_delta", text: "Hi", parentToolUseId: null }, 0);
    expect(getRenderCount()).toBe(1);

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Read",
        input: { file_path: "x" },
        parentToolUseId: null,
      },
      0,
    );
    expect(getRenderCount()).toBe(2);
  });

  test("nested subagents work correctly with task lifecycle events", () => {
    const { router } = setup();

    // task_started creates an indented container
    router.handleEvent(
      {
        type: "task_started",
        taskId: "task_outer",
        toolUseId: "outer",
        description: "Outer task",
        prompt: "Do outer work",
      },
      0,
    );
    expect(router.state.toolIdToContainer.has("outer")).toBe(true);

    // Nested agent inside the task
    router.handleEvent(
      {
        type: "task_started",
        taskId: "task_inner",
        toolUseId: "inner",
        description: "Inner task",
        prompt: "Do inner work",
      },
      0,
    );
    expect(router.state.toolIdToContainer.has("inner")).toBe(true);

    // Inner task completes
    router.handleEvent(
      {
        type: "task_done",
        taskId: "task_inner",
        toolUseId: "inner",
        status: "completed",
        summary: "Inner done",
        durationMs: 1000,
      },
      0,
    );
    expect(router.state.toolIdToContainer.has("inner")).toBe(false);

    // Outer task completes
    router.handleEvent(
      {
        type: "task_done",
        taskId: "task_outer",
        toolUseId: "outer",
        status: "completed",
        summary: "Outer done",
        durationMs: 5000,
      },
      0,
    );
    expect(router.state.toolIdToContainer.has("outer")).toBe(false);
  });

  test("parallel subagents render as siblings, not nested", () => {
    const { root, router } = setup();

    // Main agent spawns two parallel Agent tool calls
    router.handleEvent(
      {
        type: "tool_start",
        toolId: "agent1",
        tool: "Agent",
        input: { description: "Code reuse review", model: "haiku" },
        parentToolUseId: null,
      },
      0,
    );
    router.handleEvent(
      {
        type: "tool_start",
        toolId: "agent2",
        tool: "Agent",
        input: { description: "Code quality review", model: "haiku" },
        parentToolUseId: null,
      },
      0,
    );

    // Both should be children of root, not nested
    // root: [box1, box2]
    expect(root.children).toHaveLength(2);
    const box1 = root.children[0] as PipeBox;
    const box2 = root.children[1] as PipeBox;
    expect(box1).toBeInstanceOf(PipeBox);
    expect(box2).toBeInstanceOf(PipeBox);

    // Events inside each agent route to their own container
    router.handleEvent(
      {
        type: "tool_start",
        toolId: "read1",
        tool: "Read",
        input: { file_path: "a.ts" },
        parentToolUseId: "agent1",
      },
      0,
    );
    router.handleEvent(
      {
        type: "tool_start",
        toolId: "read2",
        tool: "Read",
        input: { file_path: "b.ts" },
        parentToolUseId: "agent2",
      },
      0,
    );

    expect(box1.children).toHaveLength(1);
    expect(box2.children).toHaveLength(1);

    // task_done sets footer on each PipeBox
    router.handleEvent(
      {
        type: "task_done",
        taskId: "t1",
        toolUseId: "agent1",
        status: "completed",
        summary: "Reuse review done",
        durationMs: 5000,
      },
      0,
    );
    router.handleEvent(
      {
        type: "task_done",
        taskId: "t2",
        toolUseId: "agent2",
        status: "completed",
        summary: "Quality review done",
        durationMs: 6000,
      },
      0,
    );

    // Still just 2 PipeBoxes on root (footers are inside the boxes)
    expect(root.children).toHaveLength(2);
    const rendered1 = renderChild(root, 0);
    const rendered2 = renderChild(root, 1);
    expect(rendered1).toContain("Reuse review done");
    expect(rendered2).toContain("Quality review done");
  });

  test("e2e: parallel subagents from stub scenario render as flat siblings", async () => {
    const { root, router } = setup();
    const adapter = createStubAdapter(PARALLEL_SUBAGENTS);
    const session = adapter.spawn("Run reviews");

    // Feed all events through the router (same as the real TUI does)
    for await (const event of session.events) {
      router.handleEvent(event, 0);
    }

    // Strip ANSI codes for structural assertions
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
    const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
    const plainOutput = strip(root.render(200).join("\n"));
    const lines = plainOutput.split("\n").filter((l) => l.trim());

    // All three agent headers should appear at root level (no │ prefix)
    const agentHeaders = lines.filter((l) => l.includes("┌ agent"));
    expect(agentHeaders).toHaveLength(3);
    for (const header of agentHeaders) {
      expect(header).not.toMatch(/^│/);
    }

    // All three completion summaries should be at root level
    const summaries = lines.filter((l) => l.includes("└ ✓ completed"));
    expect(summaries).toHaveLength(3);
    for (const summary of summaries) {
      expect(summary).not.toMatch(/^│/);
    }
    expect(summaries.some((s) => s.includes("Code reuse review"))).toBe(true);
    expect(summaries.some((s) => s.includes("Code quality review"))).toBe(true);
    expect(summaries.some((s) => s.includes("Efficiency review"))).toBe(true);

    // Inner tool calls should be exactly one PipeBox deep
    const toolLines = lines.filter((l) => l.includes("read") || l.includes("glob"));
    expect(toolLines.length).toBeGreaterThanOrEqual(4); // 1 + 2 + 1 across three agents
    for (const line of toolLines) {
      expect(line).toMatch(/^│ /); // indented
      expect(line).not.toMatch(/^│ │/); // not double-nested
    }

    // Text from each subagent should be inside its PipeBox (one level deep)
    const textLines = lines.filter((l) => l.includes("›"));
    // 3 subagent texts + 2 root-level texts = at least 3 indented
    const indentedTexts = textLines.filter((l) => l.startsWith("│ "));
    expect(indentedTexts.length).toBeGreaterThanOrEqual(3);
  });
});
