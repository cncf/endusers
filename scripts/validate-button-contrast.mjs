import fs from 'node:fs';
import { reportAndExit } from './lib/validate-utils.mjs';

// Every other scripts/validate-*.mjs collects findings into an `errors`
// array and hands it to reportAndExit() for a uniform report format (grouped
// [error]/[warn] lines on stderr, exit code 1 on failure) — this was the one
// holdout, throwing a raw Error and relying on Node's uncaught-exception
// stack dump instead. That diverges from the shared validator contract every
// script in `validate:all` otherwise honors.

const PATH = 'src/css/custom.css';

const css = fs.readFileSync(new URL(`../${PATH}`, import.meta.url), 'utf8');
const colors = [
  ...css.matchAll(/--cncf-button-background(?:-hover)?:\s*(#[0-9a-f]{6})/gi),
].map(([, color]) => color.toLowerCase());

function luminance(color) {
  const channels = [1, 3, 5].map(
    (index) => parseInt(color.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

const errors = [];
if (
  colors.length !== 4 ||
  colors.some((color) => contrast(color, '#ffffff') < 4.5)
) {
  errors.push({
    path: PATH,
    severity: 'error',
    message: `Button backgrounds must provide 4.5:1 contrast with white text: ${colors.join(', ')}`,
  });
}

reportAndExit(errors, 'button contrast');
console.log(
  `Button contrast validated for ${colors.length} theme backgrounds.`,
);
