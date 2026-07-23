export type { RunReporter } from "../lib/run-reporter.js";

export interface RunOutput {
  readonly isTTY: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(text: string): void;
  on?(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
}
