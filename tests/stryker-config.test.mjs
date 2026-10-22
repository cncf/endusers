// stryker.config.mjs leaves out the tests that read source text, by file and
// by name. An entry naming a test that was renamed or deleted excludes
// nothing, so a stale list would quietly stop explaining the run.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  breakThreshold,
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

// The break threshold gates the pull_request lane and a local run, and stands
// down for the scheduled and workflow_dispatch full-tree lanes: a full-tree
// score reflects the whole repository, not the diff under review, so it must
// not block on a threshold tuned for incremental work.
test('breakThreshold gates pull_request runs', () => {
  assert.equal(breakThreshold('pull_request'), 90);
});

test('breakThreshold keeps the gate for a local run with no event name', () => {
  assert.equal(breakThreshold(undefined), 90);
  assert.equal(breakThreshold(''), 90);
});

test('breakThreshold stands down for the full-tree report lanes', () => {
  assert.equal(breakThreshold('schedule'), null);
  assert.equal(breakThreshold('workflow_dispatch'), null);
});

for (const [eventName, expected] of [
  [undefined, 90],
  ['pull_request', 90],
  ['merge_group', null],
  ['schedule', null],
  ['workflow_dispatch', null],
]) {
  test(`exported mutation config selects the threshold for ${eventName ?? 'local runs'}`, () => {
    const env = { ...process.env };
    delete env.GITHUB_EVENT_NAME;
    if (eventName !== undefined) env.GITHUB_EVENT_NAME = eventName;
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import config from ${JSON.stringify(new URL('../stryker.config.mjs', import.meta.url).href)};
console.log(JSON.stringify(config.thresholds.break));`,
      ],
      { encoding: 'utf8', env },
    );
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout), expected);
  });
}
