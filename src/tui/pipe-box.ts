import type { Component } from "@mariozechner/pi-tui";
import { dim } from "./colors.js";

const PIPE_PREFIX = dim("│ ");

/**
 * A container that prefixes each rendered child line with a dimmed `│ `.
 * Used for visually nesting subagent output.
 */
export class PipeBox implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const idx = this.children.indexOf(component);
    if (idx !== -1) this.children.splice(idx, 1);
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate();
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    for (const child of this.children) {
      for (const line of child.render(innerWidth)) {
        lines.push(PIPE_PREFIX + line);
      }
    }
    return lines;
  }
}
