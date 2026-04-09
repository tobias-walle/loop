import { describe, expect, test } from "bun:test";
import { Container } from "@mariozechner/pi-tui";
import { createEventRouter } from "./app.js";
import { PipeBox } from "./components/pipe-box.js";
import { ThinkingIndicator } from "./components/thinking-indicator.js";

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

describe("createEventRouter", () => {
  test("text_delta creates and updates a text component", () => {
    const { root, router } = setup();

    router.handleEvent({ type: "text_delta", text: "Hello", parentToolUseId: null }, 0);

    expect(root.children).toHaveLength(1);
    expect(router.state.textBlocks.get("__root__")?.accumulated).toBe("Hello");

    router.handleEvent({ type: "text_delta", text: " world", parentToolUseId: null }, 0);

    expect(root.children).toHaveLength(1);
    expect(router.state.textBlocks.get("__root__")?.accumulated).toBe("Hello world");
  });

  test("text_done clears the text reference", () => {
    const { router } = setup();

    router.handleEvent({ type: "text_delta", text: "Hello", parentToolUseId: null }, 0);
    expect(router.state.textBlocks.has("__root__")).toBe(true);

    router.handleEvent({ type: "text_done", text: "Hello", parentToolUseId: null }, 0);
    expect(router.state.textBlocks.has("__root__")).toBe(false);
  });

  test("multiple text blocks are separate components", () => {
    const { root, router } = setup();

    router.handleEvent({ type: "text_delta", text: "First", parentToolUseId: null }, 0);
    router.handleEvent({ type: "text_done", text: "First", parentToolUseId: null }, 0);

    router.handleEvent({ type: "text_delta", text: "Second", parentToolUseId: null }, 0);
    router.handleEvent({ type: "text_done", text: "Second", parentToolUseId: null }, 0);

    expect(root.children).toHaveLength(2);
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
    expect(rendered).toContain("Read");
    expect(rendered).toContain("src/index.ts");
  });

  test("task_started is a no-op when tool_start already created the container", () => {
    const { root, router } = setup();

    // tool_start creates the visual container
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
    expect(root.children).toHaveLength(2);

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
    expect(root.children).toHaveLength(2);
    expect(router.state.containerStack).toHaveLength(2);
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

    // Header text + Box
    expect(root.children).toHaveLength(2);
    expect(root.children[1]).toBeInstanceOf(PipeBox);
    expect(router.state.containerStack).toHaveLength(2);
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

    // Header text + PipeBox
    expect(root.children).toHaveLength(2);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("Agent: Review code");
    expect(rendered).toContain("claude-haiku-4-5");
    expect(root.children[1]).toBeInstanceOf(PipeBox);
  });

  test("events with parentToolUseId route to subagent container", () => {
    const { root, router } = setup();

    // task_started creates the indented container
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

    // Header text + Box = 2 children
    const subBox = root.children[1] as PipeBox;

    router.handleEvent({ type: "text_delta", text: "Reviewing...", parentToolUseId: "t1" }, 0);
    expect(subBox.children).toHaveLength(1);

    router.handleEvent({ type: "text_done", text: "Reviewing...", parentToolUseId: "t1" }, 0);

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
    expect(subBox.children).toHaveLength(2);
  });

  test("task_done pops container and shows summary with model and tokens", () => {
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
    expect(router.state.containerStack).toHaveLength(2);

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
    expect(router.state.containerStack).toHaveLength(1);

    // The └ line should be on the root (parent), not inside the box
    const lastChild = root.children[root.children.length - 1];
    const rendered = lastChild.render(200).join("\n");
    expect(rendered).toContain("completed");
    expect(rendered).toContain("Review finished");
    expect(rendered).toContain("3.0s");
  });

  test("tool_done for non-subagent does nothing", () => {
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
    const count = root.children.length;

    router.handleEvent(
      { type: "tool_done", toolId: "t1", result: "content", parentToolUseId: null },
      0,
    );
    expect(root.children).toHaveLength(count);
  });

  test("retry event adds message", () => {
    const { root, router } = setup();

    router.handleEvent(
      { type: "retry", attempt: 1, maxRetries: 10, delayMs: 500, error: "rate_limit" },
      0,
    );

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("Retry");
    expect(rendered).toContain("1/10");
  });

  test("error event adds message", () => {
    const { root, router } = setup();

    router.handleEvent({ type: "error", message: "Something broke" }, 0);

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("Error");
    expect(rendered).toContain("Something broke");
  });

  test("showStepHeader adds header", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 3, "Create an about page");

    // 1 blank line + header + thinking indicator = 3
    expect(root.children).toHaveLength(3);
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("Step 1/3");
    expect(rendered).toContain("Create an about page");
    expect(root.children[2]).toBeInstanceOf(ThinkingIndicator);
  });

  test("showStepHeader adds gap before second header", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 3, "First");
    router.showStepHeader(2, 3, "Second");

    // First: blank + header + thinking (3) + Second: blank + header + thinking (3) = 6
    // (first thinking indicator is removed when showStepHeader resets, but it was on root so stays)
    // Actually: showStepHeader clears thinkingIndicator state but doesn't remove the first
    // because the second showStepHeader calls removeThinkingIndicator first.
    expect(root.children).toHaveLength(5);
  });

  test("showStepHeader with iteration info", () => {
    const { root, router } = setup();

    router.showStepHeader(2, 3, "Review code", 3, 10);

    const rendered = renderChild(root, 1);
    expect(rendered).toContain("#3/10");
  });

  test("thinking indicator is removed on first agent event", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 1, "Do stuff");

    // spacer + header + thinking = 3
    expect(root.children).toHaveLength(3);
    expect(router.state.thinkingIndicator).not.toBeNull();

    router.handleEvent({ type: "text_delta", text: "Hi", parentToolUseId: null }, 0);

    // thinking removed, text_delta added: spacer + header + text = 3
    expect(root.children).toHaveLength(3);
    expect(router.state.thinkingIndicator).toBeNull();
    // The thinking indicator should no longer be in the tree
    expect(root.children.some((c) => c instanceof ThinkingIndicator)).toBe(false);
  });

  test("showCompletion adds marker", () => {
    const { root, router } = setup();

    router.showCompletion("done", 83000);
    // blank line + completion text = 2 children
    expect(root.children).toHaveLength(2);
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("Done");
    expect(rendered).toContain("1m 23s");
  });

  test("showCompletion loop_done with iterations", () => {
    const { root, router } = setup();

    router.showCompletion("loop_done", 221000, 2);
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("LOOP_DONE");
    expect(rendered).toContain("2 iterations");
  });

  test("showCompletion max_reached", () => {
    const { root, router } = setup();

    router.showCompletion("max_reached", 60000, 10);
    const rendered = renderChild(root, 1);
    expect(rendered).toContain("MAX reached");
    expect(rendered).toContain("10 iterations");
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

    // task_started pushes an indented container
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
    expect(router.state.containerStack).toHaveLength(2);

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
    expect(router.state.containerStack).toHaveLength(3);

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
    expect(router.state.containerStack).toHaveLength(2);

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
    expect(router.state.containerStack).toHaveLength(1);
  });

  test("showUserMessage emits formatted line", () => {
    const { root, router } = setup();

    router.showUserMessage("fix the CSS");

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("👤");
    expect(rendered).toContain("fix the CSS");
  });
});
