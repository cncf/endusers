// The no-restricted-syntax selectors in eslint.config.mjs are hand-written
// esquery, so a typo makes them match nothing and `npm run check:lint` stays
// green. Each case lints a snippet through the real config and checks the
// rule fires on the bad shape and stays quiet on the legitimate one beside it.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';

import config from '../eslint.config.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const linter = new Linter({ cwd: repoRoot });

/** `line:ruleId` for every message ESLint reports on `code` at `file`. */
function lint(file, code) {
  return linter
    .verify(code, config, { filename: join(repoRoot, file) })
    .map(({ line, ruleId }) => `${line}:${ruleId}`);
}

test('URL.pathname is banned for module-relative paths but not web URLs', () => {
  const code = [
    "import { fileURLToPath } from 'node:url';",
    "export const a = new URL('..', import.meta.url).pathname;",
    'export const b = new URL(import.meta.url).pathname;',
    "export const c = fileURLToPath(new URL('..', import.meta.url));",
    "export const d = new URL('https://example.com/x').pathname;",
  ].join('\n');
  assert.deepEqual(lint('scripts/fixture.mjs', code), [
    '2:no-restricted-syntax',
    '3:no-restricted-syntax',
  ]);
});

test('JSX in src/ must use camelCase DOM props and safe link attributes', () => {
  const code = [
    'export function Icon({ href }) {',
    '  return (',
    '    <div>',
    '      <svg><path stroke-width="2" /></svg>',
    '      <a href="https://example.com">x</a>',
    '      <a href={href}>x</a>',
    '      <a href="http://example.com" rel="noreferrer">x</a>',
    '      <img src="/a.png" />',
    '      <a href={href} rel="noopener noreferrer">x</a>',
    '      <a href="/docs">x</a>',
    '      <a href={`#${href}`}>x</a>',
    '      <img src="/a.png" alt="" />',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
  assert.deepEqual(lint('src/fixture.js', code), [
    '4:react/no-unknown-property',
    '5:no-restricted-syntax',
    '6:no-restricted-syntax',
    '7:no-restricted-syntax',
    '8:jsx-a11y/alt-text',
  ]);
});
