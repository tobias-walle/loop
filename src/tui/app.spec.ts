import { describe, expect, test } from "bun:test";
import { Box, Container } from "@mariozechner/pi-tui";
import { createEventRouter } from "./app.js";

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

  test("tool_start for Task creates a nested container", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Task",
        input: { task: "Review code" },
        parentToolUseId: null,
      },
      0,
    );

    expect(root.children).toHaveLength(2);
    expect(root.children[1]).toBeInstanceOf(Box);
    expect(router.state.containerStack).toHaveLength(2);
  });

  test("events with parentToolUseId route to subagent container", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Task",
        input: { task: "Review code" },
        parentToolUseId: null,
      },
      0,
    );

    const subBox = root.children[1] as Box;

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

  test("tool_done for subagent pops container", () => {
    const { root, router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "t1",
        tool: "Task",
        input: { task: "Review" },
        parentToolUseId: null,
      },
      0,
    );
    expect(router.state.containerStack).toHaveLength(2);

    router.handleEvent(
      { type: "tool_done", toolId: "t1", result: "Done", parentToolUseId: null },
      0,
    );
    expect(router.state.containerStack).toHaveLength(1);

    const subBox = root.children[1] as Box;
    const lastChild = subBox.children[subBox.children.length - 1];
    const rendered = lastChild.render(200).join("\n");
    expect(rendered).toContain("Done");
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

    expect(root.children).toHaveLength(1);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("Step 1/3");
    expect(rendered).toContain("Create an about page");
  });

  test("showStepHeader adds blank line before second header", () => {
    const { root, router } = setup();

    router.showStepHeader(1, 3, "First");
    router.showStepHeader(2, 3, "Second");

    // First header (1) + blank (1) + second header (1) = 3
    expect(root.children).toHaveLength(3);
  });

  test("showStepHeader with iteration info", () => {
    const { root, router } = setup();

    router.showStepHeader(2, 3, "Review code", 3, 10);

    const rendered = renderChild(root, 0);
    expect(rendered).toContain("iteration 3/10");
  });

  test("showCompletion adds marker", () => {
    const { root, router } = setup();

    router.showCompletion("done", 83000);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("Done");
    expect(rendered).toContain("1m 23s");
  });

  test("showCompletion loop_done with iterations", () => {
    const { root, router } = setup();

    router.showCompletion("loop_done", 221000, 2);
    const rendered = renderChild(root, 0);
    expect(rendered).toContain("LOOP_DONE");
    expect(rendered).toContain("2 iterations");
  });

  test("showCompletion max_reached", () => {
    const { root, router } = setup();

    router.showCompletion("max_reached", 60000, 10);
    const rendered = renderChild(root, 0);
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

  test("nested subagents work correctly", () => {
    const { router } = setup();

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "outer",
        tool: "Task",
        input: { task: "Outer" },
        parentToolUseId: null,
      },
      0,
    );

    router.handleEvent(
      {
        type: "tool_start",
        toolId: "inner",
        tool: "Task",
        input: { task: "Inner" },
        parentToolUseId: "outer",
      },
      0,
    );
    expect(router.state.containerStack).toHaveLength(3);

    router.handleEvent(
      { type: "tool_done", toolId: "inner", result: "ok", parentToolUseId: "outer" },
      0,
    );
    expect(router.state.containerStack).toHaveLength(2);

    router.handleEvent(
      { type: "tool_done", toolId: "outer", result: "ok", parentToolUseId: null },
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
