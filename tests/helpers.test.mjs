import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepoRoot, runScriptWithFixtures } from './helpers.mjs';

// tests/helpers.mjs is the harness every fixture-based validator test runs
// through, so a silent regression in it degrades those suites rather than
// failing them: a sandbox that quietly reads the real repository would make
// every "rejects X" assertion pass for the wrong reason. Nothing else in the
// suite exercises the harness itself.

const repoRoot = resolveRepoRoot(import.meta.url);

test('resolveRepoRoot decodes percent-encoded path segments', () => {
  // `new URL('..', url).pathname` returns '/tmp/space%20dir/repo/' here, which
  // names no directory on disk. Every sandbox run under such a checkout dies
  // in cpSync with ENOENT.
  assert.equal(
    resolveRepoRoot('file:///tmp/space dir/repo/tests/helpers.mjs'),
    '/tmp/space dir/repo/',
  );
});

test('resolveRepoRoot resolves this checkout to the repository root', () => {
  assert.ok(
    existsSync(join(repoRoot, 'scripts')),
    `resolveRepoRoot returned ${repoRoot}, which has no scripts/ directory`,
  );
  assert.ok(existsSync(join(repoRoot, 'tests', 'helpers.mjs')));
});

test('the sandbox mirrors scripts/lib so shared imports resolve', () => {
  // validate-awards.mjs imports ./lib/validate-utils.mjs. If the mirror ever
  // stopped copying scripts/lib, the script would die with
  // ERR_MODULE_NOT_FOUND and a status of 1 — indistinguishable, to a test
  // that only asserts a non-zero exit, from a rejected fixture.
  const result = runScriptWithFixtures('validate-awards.mjs', {
    'data/awards.json': JSON.stringify({
      verifiedAt: '2026-08-08',
      verifiedAgainst: 'https://contribute.cncf.io/community/awards/',
      awards: [
        {
          year: 2024,
          slug: 'acme',
          award: 'Top End User Award',
          awardLabel: 'Winner',
          organization: 'Acme Corp',
          citation: 'For outstanding adoption of cloud native.',
          event: 'KubeCon NA 2024',
          announcementUrl: 'https://www.cncf.io/announcements/2024/example',
        },
      ],
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
});

test('fixtures are written at the repo-relative paths the script reads', () => {
  // validate-button-contrast.mjs reads ../src/css/custom.css, a nested path
  // that the harness has to create on the way.
  const css = ['#005ea8', '#004f91', '#007f68', '#006f5b']
    .map((color, index) =>
      index % 2 === 0
        ? `--cncf-button-background: ${color};`
        : `--cncf-button-background-hover: ${color};`,
    )
    .join('\n');
  const result = runScriptWithFixtures('validate-button-contrast.mjs', {
    'src/css/custom.css': css,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /4 theme backgrounds/);
});

test('a script reads the sandbox rather than the real repository', () => {
  // Supplying no fixture must fail. If the sandbox leaked the real checkout,
  // the script would find the repository's own custom.css and pass.
  const result = runScriptWithFixtures('validate-button-contrast.mjs', {});
  assert.notEqual(
    result.status,
    0,
    'the script succeeded with no fixture, so it read outside the sandbox',
  );
});

test('each run gets a sandbox of its own', () => {
  const good = ['#005ea8', '#004f91', '#007f68', '#006f5b']
    .map((color, index) =>
      index % 2 === 0
        ? `--cncf-button-background: ${color};`
        : `--cncf-button-background-hover: ${color};`,
    )
    .join('\n');
  const first = runScriptWithFixtures('validate-button-contrast.mjs', {
    'src/css/custom.css': good,
  });
  assert.equal(first.status, 0, first.stderr);
  const second = runScriptWithFixtures('validate-button-contrast.mjs', {});
  assert.notEqual(
    second.status,
    0,
    'the second run saw the first run\u2019s fixture',
  );
});

test('the sandbox directory is removed once the run returns', () => {
  // A run with no fixture dies in readFileSync, and the ENOENT names the
  // sandbox it was reading. Recovering the path that way pins the assertion to
  // this run's own directory; counting `endusers-test-*` entries in the shared
  // temp directory instead races the sandboxes the other test files create and
  // delete concurrently, which is what made this assertion fail in CI against
  // a harness that cleans up correctly.
  const result = runScriptWithFixtures('validate-button-contrast.mjs', {});
  const match = result.stderr.match(/(\S*endusers-test-[^/\\]+)[/\\]src[/\\]/);
  assert.ok(
    match,
    `could not recover the sandbox path from stderr: ${result.stderr}`,
  );
  assert.ok(
    !existsSync(match[1]),
    `sandbox ${match[1]} survived the run and leaked into the temp directory`,
  );
});

test('stdout, stderr and status are reported separately', () => {
  const result = runScriptWithFixtures('validate-awards.mjs', {
    'data/awards.json': JSON.stringify({
      verifiedAt: '2026-08-08',
      verifiedAgainst: 'https://contribute.cncf.io/community/awards/',
      awards: [],
    }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
  assert.equal(result.stdout, '');
});
