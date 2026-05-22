import type { Readable } from "node:stream";

export type PiRpcCommand =
  | { id?: string; type: "prompt"; message: string }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "get_session_stats" };

export async function* readJsonLines(stream: Readable): AsyncGenerator<unknown> {
  let buffer = "";
  let ended = false;
  const lines: string[] = [];
  let wake: (() => void) | undefined;

  const flush = () => {
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      let line = buffer.slice(0, index);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  };
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    flush();
    notify();
  };
  const onEnd = () => {
    ended = true;
    notify();
  };

  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("close", onEnd);
  stream.on("error", onEnd);

  try {
    while (true) {
      if (lines.length > 0) {
        const line = lines.shift()?.trim();
        if (!line) continue;
        yield JSON.parse(line);
        continue;
      }
      if (ended) {
        const line = buffer.trim();
        buffer = "";
        if (line) yield JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line);
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("close", onEnd);
    stream.off("error", onEnd);
  }
}

export function writeRpcCommand(
  stdin: NodeJS.WritableStream | null | undefined,
  command: PiRpcCommand,
): boolean {
  return stdin?.write(`${JSON.stringify(command)}\n`) ?? false;
}
