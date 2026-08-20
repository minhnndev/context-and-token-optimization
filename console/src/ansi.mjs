// Minimal ANSI helpers — the terminal is the display, no dependencies needed.
export const ESC = '\x1b[';
export const altScreen = { enter: `${ESC}?1049h${ESC}H`, exit: `${ESC}?1049l` };
export const cursor = { hide: `${ESC}?25l`, show: `${ESC}?25h`, home: `${ESC}H` };

const CODES = { reset: 0, bold: 1, dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90 };
export function paint(text, ...styles) {
  const open = styles.map((s) => `${ESC}${CODES[s]}m`).join('');
  return `${open}${text}${ESC}0m`;
}

export const STATUS_COLOR = { ok: 'green', warn: 'yellow', crit: 'red' };
export function statusDot(status) {
  return paint('●', STATUS_COLOR[status]);
}
