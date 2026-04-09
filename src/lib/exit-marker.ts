export function extractExitMarker(text: string): {
  type: "loop_done" | "loop_continue" | "none";
  status?: string;
} {
  const trimmed = text.trimEnd();
  const lastLine = trimmed.split("\n").pop()?.trim() ?? "";

  if (lastLine === "LOOP_DONE") {
    return { type: "loop_done" };
  }
  if (lastLine.startsWith("LOOP_CONTINUE:")) {
    const status = lastLine.slice("LOOP_CONTINUE:".length).trim();
    return { type: "loop_continue", status };
  }
  return { type: "none" };
}
