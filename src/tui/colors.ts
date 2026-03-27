const ESC = "\x1b[";
const RESET = `${ESC}0m`;

function wrap(code: string, text: string): string {
  return `${ESC}${code}m${text}${RESET}`;
}

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
