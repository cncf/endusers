import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { resolveRepoRoot } from './helpers.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);

// Read-only validators that must pass against the repository's current
// generated data. Scripts that clone upstream repos or call network APIs
// (collect-metrics, fetch-community-people, import-architectures) are
// intentionally excluded.
const READ_ONLY_VALIDATORS = [
  'validate-metrics.mjs',
  'validate-awards.mjs',
  'validate-architectures.mjs',
  'validate-architecture-assets.mjs',
  'validate-button-contrast.mjs',
  'validate-case-studies.mjs',
  'validate-radar-reports.mjs',
  'validate-community-people.mjs',
  'validate-community-groups.mjs',
];

for (const script of READ_ONLY_VALIDATORS) {
  test(`${script} passes against current repo data`, () => {
    const stdout = execFileSync('node', [join(repoRoot, 'scripts', script)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(stdout, /[Vv]alidated|validated/);
  });
}
