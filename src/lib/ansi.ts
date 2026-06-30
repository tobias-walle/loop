// Low-level ANSI primitives
export const ESC = "\x1b[";
export const RESET = `${ESC}0m`;

export function wrap(code: string, text: string): string {
  return `${ESC}${code}m${text}${RESET}`;
}

/** 24-bit foreground color (no width shift from DIM/BOLD). */
export function rgbFg(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
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

export function boldGreen(text: string): string {
  return `${ESC}1;32m${text}${RESET}`;
}

export function boldRed(text: string): string {
  return `${ESC}1;31m${text}${RESET}`;
}
