import { bold, boldRed, cyan, dim, green, magenta, yellow } from "../lib/ansi.js";

const TOOL_PREVIEW_LIMIT = 500;

type Style = {
  heading(text: string): string;
  secondary(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  tool(text: string): string;
};

export function consoleStyle(isTTY: boolean): Style {
  if (!isTTY) {
    const plain = (text: string): string => text;
    return {
      heading: plain,
      secondary: plain,
      success: plain,
      warning: plain,
      error: plain,
      tool: plain,
    };
  }
  return {
    heading: bold,
    secondary: dim,
    success: green,
    warning: yellow,
    error: boldRed,
    tool: magenta,
  };
}

export function formatToolPreview(tool: string, input: Record<string, unknown>): string {
  const candidate =
    input.command ??
    input.file_path ??
    input.path ??
    input.query ??
    input.pattern ??
    input.description ??
    input.task ??
    Object.values(input).find((value) => typeof value === "string") ??
    "";
  const text = String(candidate).replace(/\s+/g, " ").trim();
  const preview = text ? `${tool.toLowerCase()} ${text}` : tool.toLowerCase();
  return preview.length > TOOL_PREVIEW_LIMIT
    ? `${preview.slice(0, TOOL_PREVIEW_LIMIT - 3)}...`
    : preview;
}

export function formatAssistantBlock(text: string, isTTY: boolean): string {
  const marker = isTTY ? cyan("›") : ">";
  const lines = text.replace(/^\s+/, "").split("\n");
  return lines.map((line, index) => (index === 0 ? `${marker} ${line}` : line)).join("\n");
}
