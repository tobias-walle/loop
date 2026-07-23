import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { RESET, dim, rgbFg } from "../../lib/ansi.js";

/**
 * Muted color palette for subagent pipe brackets.
 * Each entry is an [r, g, b] tuple — chosen to be distinct yet unobtrusive.
 */
const AGENT_COLORS: [number, number, number][] = [
  [130, 170, 255], // blue
  [200, 140, 255], // purple
  [100, 200, 180], // teal
  [220, 180, 100], // amber
  [200, 120, 160], // rose
  [120, 190, 120], // green
];

let colorIndex = 0;

/** Pick the next color from the rotating palette. */
export function nextAgentColor(): (text: string) => string {
  const [r, g, b] = AGENT_COLORS[colorIndex % AGENT_COLORS.length];
  colorIndex++;
  return (text: string) => `${rgbFg(r, g, b)}${text}${RESET}`;
}

/**
 * A container that prefixes each rendered child line with a `│ ` pipe.
 * Optionally renders a `┌ header` / `└ footer` bracket around the content.
 * When a colorize function is provided, the bracket characters are colored.
 */
export class PipeBox implements Component {
  children: Component[] = [];
  private header: string | null = null;
  private footer: string | null = null;
  private colorize: ((text: string) => string) | null;

  constructor(colorize?: (text: string) => string) {
    this.colorize = colorize ?? null;
  }

  setHeader(text: string): void {
    this.header = text;
  }

  setFooter(text: string): void {
    this.footer = text;
  }

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
    const c = this.colorize ?? dim;
    const pipePrefix = `${c("│")} `;
    const innerWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    if (this.header != null) {
      lines.push(`${c("┌")} ${this.header}`);
    }
    for (const child of this.children) {
      for (const line of child.render(innerWidth)) {
        lines.push(pipePrefix + line);
      }
    }
    if (this.footer != null) {
      lines.push(`${c("└")} ${this.footer}`);
    }
    return lines.map((line) => truncateToWidth(line, width, "", true));
  }
}
