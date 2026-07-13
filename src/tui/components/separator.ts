import type { Component } from "@mariozechner/pi-tui";
import { dimGray } from "../../lib/ansi.js";

export class Separator implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    return [dimGray("─".repeat(width))];
  }
}
