import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { resolveRepoRoot } from './helpers.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);

// Read-only validators that must pass against the repository's current
// generated data. Scripts that clone upstream repos or call network APIs
// (collect-metrics, fetch-community-people, collect-enduser-members) are
// intentionally excluded.
const READ_ONLY_VALIDATORS = [
  'validate-metrics.mjs',
  'validate-launch-metrics.mjs',
  'validate-awards.mjs',
  'validate-architectures.mjs',
  'validate-architecture-assets.mjs',
  'validate-button-contrast.mjs',
  'validate-case-studies.mjs',
  'validate-radar-reports.mjs',
  'validate-community-people.mjs',
  'validate-community-groups.mjs',
  'validate-projects-born.mjs',
  'validate-end-user-talks.mjs',
  'validate-enduser-members.mjs',
  'validate-members.mjs',
];

// The working tree as git sees it, untracked files included. Used as a
// before/after pair rather than as an absolute "clean" assertion: the suite
// runs against a checkout that already holds build output, coverage
// directories and a contributor's own edits, none of which this file has any
// business failing on. Only what changes across one validator's run is its
// doing.
//
// No other test writes inside the repository -- the script sandbox
// (tests/helpers-script-sandbox.mjs) copies into a tmpdir first -- so a
// concurrent test file cannot move this snapshot underneath a validator.
function workingTreeState() {
  return execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

for (const script of READ_ONLY_VALIDATORS) {
  test(`${script} passes against current repo data`, () => {
    // "Read-only" is the entry condition for this list, and until now nothing
    // checked it: every name here is executed against the real repository on
    // every pull request, so a validator that starts writing -- an auto-fix
    // that stops honouring its --fix flag, a mirror step that lands in
    // static/ -- would silently edit the checkout mid-suite and leave CI
    // committing to a tree the PR never proposed.
    const before = workingTreeState();

    const stdout = execFileSync('node', [join(repoRoot, 'scripts', script)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(stdout, /[Vv]alidated|validated/);

    assert.equal(
      workingTreeState(),
      before,
      `${script} changed the working tree; READ_ONLY_VALIDATORS runs it on every pull request, so it has to leave the checkout alone`,
    );
  });
}
