import type { Component } from "@mariozechner/pi-tui";
import { formatToolLine } from "../formatters.js";

/** A width-aware activity row that truncates instead of wrapping. */
export class ToolLine implements Component {
  constructor(
    private readonly tool: string,
    private readonly input: Record<string, unknown>,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return [formatToolLine(this.tool, this.input, width)];
  }
}
