import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { stripJsonComments } from './helpers-jsonc.mjs';

// tests/dev-environment.test.mjs parses .devcontainer/devcontainer.json and
// .vscode/settings.json through this stripper and then asserts against the
// result, so a stripper that silently mangles its input would make that
// contract assert about the wrong object — passing where it should fail, or
// failing with a JSON.parse error that names no cause.
//
// Running that contract does not exercise the stripper: between them the two
// files it reads carry a single `//` line comment, no `/* */` block comment
// and no backslash escape, so the block-comment arms, the string-escape arm
// and the end-of-input tail never execute. Every case below is a shape the
// stripper claims to handle that no file in the repo currently has.
const root = new URL('..', import.meta.url).pathname;

test('line comments are removed and the newline that ends them is kept', () => {
  assert.equal(
    stripJsonComments('{\n  // a comment\n  "a": 1\n}'),
    '{\n  \n  "a": 1\n}',
  );
  // A line comment that runs to end-of-input has no newline to re-emit.
  assert.equal(stripJsonComments('{"a": 1} // trailing'), '{"a": 1} ');
});

test('block comments are removed, including across lines', () => {
  assert.equal(stripJsonComments('{/* gone */"a": 1}'), '{"a": 1}');
  assert.equal(
    stripJsonComments('{\n/* line one\n   line two */\n"a": 1}'),
    '{\n\n"a": 1}',
  );
  // A lone `*` inside the block must not close it; only `*/` does.
  assert.equal(stripJsonComments('{/* a * b */"a": 1}'), '{"a": 1}');
  // `/*` inside a block comment does not nest.
  assert.equal(stripJsonComments('{/* /* */"a": 1}'), '{"a": 1}');
  // An unterminated block comment consumes the rest of the input rather than
  // emitting half a document.
  assert.equal(stripJsonComments('{"a": 1} /* never closed'), '{"a": 1} ');
});

test('comment markers inside strings survive', () => {
  // The case the stripper exists for: a URL in a value.
  assert.equal(
    stripJsonComments('{"url": "https://example.com"}'),
    '{"url": "https://example.com"}',
  );
  assert.equal(
    stripJsonComments('{"glob": "/* not a comment */"}'),
    '{"glob": "/* not a comment */"}',
  );
});

test('a backslash escape inside a string is copied with the character it escapes', () => {
  // The escape arm exists so an escaped quote does not end the string and
  // hand the rest of the document to the comment scanner.
  assert.equal(
    stripJsonComments('{"a": "x\\"// still a string"}'),
    '{"a": "x\\"// still a string"}',
  );
  assert.equal(
    stripJsonComments('{"a": "back\\\\slash"} // gone'),
    '{"a": "back\\\\slash"} ',
  );
  // A trailing backslash at end of input has nothing to escape: the `?? ''`
  // tail keeps it from appending "undefined".
  assert.equal(stripJsonComments('{"a": "x\\'), '{"a": "x\\');
});

test('input with nothing to strip is returned unchanged', () => {
  const plain = '{\n  "a": [1, 2],\n  "b": {"c": true}\n}\n';
  assert.equal(stripJsonComments(plain), plain);
  assert.equal(stripJsonComments(''), '');
});

test('the stripped repo files are still parseable JSON', () => {
  // The property dev-environment.test.mjs depends on, asserted here against
  // the real inputs so a stripper regression is attributed to the stripper.
  for (const relativePath of [
    '.devcontainer/devcontainer.json',
    '.vscode/settings.json',
  ]) {
    const raw = readFileSync(join(root, relativePath), 'utf8');
    const parsed = JSON.parse(stripJsonComments(raw));
    assert.equal(
      typeof parsed,
      'object',
      `${relativePath} did not survive comment stripping as an object`,
    );
    assert.notEqual(parsed, null);
  }
});
