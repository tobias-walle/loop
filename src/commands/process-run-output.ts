import type { RunOutput } from "../output/run-reporter.js";

interface ProcessRunStream {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(text: string): unknown;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
}

export function createProcessRunOutput(stream: ProcessRunStream): RunOutput {
  return {
    isTTY: stream.isTTY === true,
    get columns() {
      return stream.columns;
    },
    get rows() {
      return stream.rows;
    },
    write: (text) => {
      stream.write(text);
    },
    on: (event, listener) => stream.on(event, listener),
    off: (event, listener) => stream.off(event, listener),
  };
}
