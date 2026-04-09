// Low-level ANSI primitives
export const ESC = "\x1b[";
export const RESET = `${ESC}0m`;
export const ITALIC = `${ESC}3m`;

// Key input constants — escape sequences used for input detection
export const KEY_ENTER = "\r";
export const KEY_NEWLINE = "\n";
export const KEY_ESCAPE = "\x1b";
export const KEY_ESCAPE_DOUBLE = "\x1b\x1b";
export const KEY_BACKSPACE = "\x7f";
export const KEY_BACKSPACE_ALT = "\b";
export const KEY_DELETE = "\x1b[3~";
export const KEY_LEFT = "\x1b[D";
export const KEY_RIGHT = "\x1b[C";
export const KEY_HOME = "\x1b[H";
export const KEY_END = "\x1b[F";
export const KEY_CTRL_A = "\x01";
export const KEY_CTRL_E = "\x05";

export function wrap(code: string, text: string): string {
  return `${ESC}${code}m${text}${RESET}`;
}

/** 24-bit foreground color (no width shift from DIM/BOLD). */
export function rgbFg(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

/** Thin line cursor used by the status bar. */
export function cursorStyle(): string {
  return `${ESC}2;90m▏${RESET}`;
}

// High-level helpers
export function dim(text: string): string {
  return wrap("2", text);
}

export function dimGray(text: string): string {
  return `${ESC}2;90m${text}${RESET}`;
}

export function bold(text: string): string {
  return wrap("1", text);
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

export function boldCyan(text: string): string {
  return `${ESC}1;36m${text}${RESET}`;
}

export function boldYellow(text: string): string {
  return `${ESC}1;33m${text}${RESET}`;
}

export function boldGreen(text: string): string {
  return `${ESC}1;32m${text}${RESET}`;
}

export function boldRed(text: string): string {
  return `${ESC}1;31m${text}${RESET}`;
}

export function boldMagenta(text: string): string {
  return `${ESC}1;35m${text}${RESET}`;
}
