// Prose under tests/ states the reason a test exists, not the issue or pull
// request that prompted it (ADR 0006). A cited issue closes, the citation
// goes stale, and the stale citation is filed as a finding of its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('.', import.meta.url));
const self = basename(fileURLToPath(import.meta.url));

// A four- or five-digit `#1234` (the range this repository's issues are in,
// short of six-digit hex colours), `endusers#1234`, and this repository's
// issue or pull URLs. The lookbehind skips HTML entities and other projects'
// references such as `npm/cli#4828`.
const CITATION =
  /(?<![\w&;])#[1-9]\d{3,4}\b|\bendusers#\d+|github\.com\/cncf\/endusers\/(?:issues|pull)\/\d+/g;

// Test data for code that parses issue and pull request references.
const DATA = new Map([
  [
    'generate-changelog.test.mjs',
    [
      '#1369',
      'github.com/cncf/endusers/pull/1',
      'github.com/cncf/endusers/pull/2',
      'github.com/cncf/endusers/pull/1044',
    ],
  ],
  [
    'import-architecture-issue.test.mjs',
    ['github.com/cncf/endusers/issues/900'],
  ],
]);

test('test prose carries no issue or pull request citations', () => {
  const found = [];
  for (const file of readdirSync(testsDir, { recursive: true })) {
    if (file === self || !/\.(?:[cm]?js|json|mdx?)$/.test(file)) continue;
    const allowed = DATA.get(file) ?? [];
    const text = readFileSync(testsDir + file, 'utf8');
    for (const [match] of text.matchAll(CITATION)) {
      if (!allowed.includes(match)) found.push(`tests/${file}: ${match}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    'State the reason in prose instead of citing an issue or pull request ' +
      'number; issue links belong in commit messages, pull requests or ADRs ' +
      '(ADR 0006).',
  );
});
