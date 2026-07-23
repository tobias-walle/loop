// Low-level ANSI primitives
export const ESC = "\x1b[";
export const RESET = `${ESC}0m`;

// Terminal ownership controls. Keep raw sequences in this module.
export const ENTER_ALT_SCREEN = `${ESC}?1049h`;
export const LEAVE_ALT_SCREEN = `${ESC}?1049l`;
export const ERASE_SCROLLBACK = `${ESC}3J`;
export const HIDE_CURSOR = `${ESC}?25l`;
export const SHOW_CURSOR = `${ESC}?25h`;
export const CLEAR_LINE = `${ESC}2K`;
export const CLEAR_FROM_CURSOR = `${ESC}0J`;
export const CLEAR_SCREEN = `${ESC}2J${ESC}H`;
export const QUERY_CELL_SIZE = `${ESC}16t`;

export function moveCursorBy(lines: number): string {
  if (lines === 0) return "";
  return `${ESC}${Math.abs(lines)}${lines > 0 ? "B" : "A"}`;
}

export function setTerminalTitle(title: string): string {
  return `\x1b]0;${title.replaceAll("\x07", "").replaceAll("\x1b", "")}\x07`;
}

export function wrap(code: string, text: string): string {
  return `${ESC}${code}m${text}${RESET}`;
}

// High-level helpers
export function dim(text: string): string {
  return wrap("2", text);
}

export function bold(text: string): string {
  return wrap("1", text);
}

export function boldCyan(text: string): string {
  return wrap("1;36", text);
}

export function boldGreen(text: string): string {
  return wrap("1;32", text);
}

export function dimGray(text: string): string {
  return wrap("2;90", text);
}

export function rgbFg(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

export function green(text: string): string {
  return wrap("32", text);
}

export function yellow(text: string): string {
  return wrap("33", text);
}

export function cyan(text: string): string {
  return wrap("36", text);
}

export function magenta(text: string): string {
  return wrap("35", text);
}

export function boldRed(text: string): string {
  return `${ESC}1;31m${text}${RESET}`;
}
