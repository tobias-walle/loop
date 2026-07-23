import type { InlineTerminalOutput } from "./inline-terminal-session.js";

export interface LiveRunOutput extends InlineTerminalOutput {
  readonly isTTY: boolean;
}

export function containLiveOutput(output: LiveRunOutput): LiveRunOutput {
  let writesDisabled = false;
  return {
    isTTY: output.isTTY,
    get columns() {
      return output.columns;
    },
    get rows() {
      return output.rows;
    },
    write(text) {
      if (writesDisabled) return;
      try {
        output.write(text);
      } catch {
        writesDisabled = true;
      }
    },
    on(event, listener) {
      try {
        return output.on?.(event, listener);
      } catch {}
    },
    off(event, listener) {
      try {
        return output.off?.(event, listener);
      } catch {}
    },
  };
}
