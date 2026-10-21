// stryker.config.mjs leaves out the tests that read source text, by file and
// by name. An entry naming a test that was renamed or deleted excludes
// nothing, so a stale list would quietly stop explaining the run.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SOURCE_TEXT_TEST_FILES,
  SOURCE_TEXT_TEST_NAMES,
} from '../stryker.config.mjs';

const testsDir = new URL('./', import.meta.url);

test('every test file the mutation run leaves out exists', () => {
  const missing = SOURCE_TEXT_TEST_FILES.filter(
    (name) => !existsSync(new URL(`${name}.test.mjs`, testsDir)),
  );
  assert.deepEqual(missing, []);
});

test('every test name the mutation run skips names a test in the suite', () => {
  const suite = readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => readFileSync(new URL(name, testsDir), 'utf8'))
    .join('\n');
  const missing = SOURCE_TEXT_TEST_NAMES.filter(
    (name) => !suite.includes(`test('${name}'`),
  );
  assert.deepEqual(missing, []);
});
