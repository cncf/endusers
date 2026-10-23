// The residual note at the top of tests/tools/e2e-coverage-run.mjs names one
// arm no probe could reach:
//
//   readProvenance  `if (!(error instanceof SyntaxError)) throw error`
//
// It is dead for a reason that lives entirely outside the arm. The `try` it
// sits under wraps a single call, `JSON.parse(raw)`; `raw` is bound from a
// `'utf8'` read, so it is always a string; and `JSON.parse` of a string throws
// nothing but `SyntaxError`. Each of those is a claim about code that can
// change without the arm changing -- widen the `try` over the `readFile`, or
// over a validator called on the parsed payload, and the re-throw goes live in
// an edit that never touches its line.
//
// An unreachable arm asserted by nothing is indistinguishable from an arm
// whose fixture is merely missing, so these tests state the premise directly,
// the way tests/e2e-coverage-error-arms.test.mjs states the premises behind
// the reporter's residuals. The consequence of getting it wrong is not only
// the region count: the re-throw abandons the whole provenance walk, so one
// unexpected failure on one capture file would lose the runtime records of
// every capture after it, where the `SyntaxError` path deliberately degrades
// to a warning and continues.
//
// The reachable half of the same `catch` -- the warning a malformed capture
// produces -- is exercised against the real function by
// tests/e2e-coverage-runtime.test.mjs and is not repeated here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RUN_SOURCE = fileURLToPath(
  new URL('./tools/e2e-coverage-run.mjs', import.meta.url),
);

// `readProvenance`'s body, from its signature to the closing brace in the
// first column. Every function in the module is written at top level, so that
// brace is unambiguous without parsing.
async function readProvenanceSource() {
  const source = await readFile(RUN_SOURCE, 'utf8');
  const start = source.indexOf('async function readProvenance(');
  assert.notEqual(
    start,
    -1,
    'tests/tools/e2e-coverage-run.mjs no longer declares readProvenance at top ' +
      'level; the residual note at the top of that file names the arm by this ' +
      'function, so rename the note with the function',
  );
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, 'readProvenance has no top-level closing brace');
  return source.slice(start, end);
}

test('readProvenance guards nothing but the JSON.parse call', async () => {
  const body = await readProvenanceSource();
  const guarded = /\btry\s*\{([\s\S]*?)\}\s*catch\s*\(/u.exec(body);
  assert.ok(guarded, 'readProvenance still guards its parse with try/catch');
  const statements = guarded[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'));
  assert.deepEqual(
    statements,
    ['payload = JSON.parse(raw);'],
    'the try block in readProvenance now guards more than the JSON.parse call, ' +
      'so its catch can see an error JSON.parse did not throw and the ' +
      '`throw error` arm the residual note calls unreachable is live; either ' +
      'narrow the try back or cover the arm and shorten the note',
  );
});

test('the argument readProvenance parses is always a string', async () => {
  const body = await readProvenanceSource();
  assert.match(
    body,
    /const raw = await readFile\([\s\S]*?,\s*'utf8'\);/u,
    "readProvenance no longer binds `raw` from a 'utf8' read; a Buffer or a " +
      'non-string argument widens what JSON.parse can throw past SyntaxError, ' +
      'which is the premise the residual note rests on',
  );
  // The same binding must stay outside the guard, or the read's own failures
  // reach a catch that only knows how to describe a parse failure.
  assert.ok(
    body.indexOf('const raw = await readFile(') < body.indexOf('try {'),
    'the `raw` binding moved inside the try block in readProvenance; a read ' +
      'error would then reach the catch, which is exactly what the ' +
      '`throw error` arm re-throws',
  );
});

// Empirical half: the residual note claims no probe could make `JSON.parse`
// fail with anything but a SyntaxError. These are the probes.
const HOSTILE_INPUTS = new Map([
  ['empty', ''],
  ['truncated object', '{"runId":'],
  ['truncated array', '[1,2,'],
  ['trailing comma', '{"a":1,}'],
  ['lone surrogate', '"\uD800"'],
  ['NUL bytes', '\u0000\u0000\u0000'],
  ['a bare identifier', 'undefined'],
  ['deeply nested arrays', `${'['.repeat(200000)}1${']'.repeat(200000)}`],
  ['deeply nested objects', `${'{"a":'.repeat(200000)}1${'}'.repeat(200000)}`],
  ['unterminated deep nesting', '['.repeat(200000)],
]);

test('JSON.parse of a string throws only SyntaxError', () => {
  for (const [name, input] of HOSTILE_INPUTS) {
    let thrown = null;
    try {
      JSON.parse(input);
    } catch (error) {
      thrown = error;
    }
    if (thrown === null) continue;
    assert.ok(
      thrown instanceof SyntaxError,
      `JSON.parse threw a ${thrown?.constructor?.name} for ${name}; the ` +
        '`throw error` arm in readProvenance is reachable after all, so cover ' +
        'it and shorten the residual note at the top of ' +
        'tests/tools/e2e-coverage-run.mjs',
    );
  }
});
