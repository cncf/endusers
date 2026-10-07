// The two instructions CONTRIBUTING.md and AGENTS.md give before a contributor
// can run the end-to-end suite at all, pinned against the workflow that runs
// the same suite in CI.
//
// Both claims below are prose in a Markdown file describing a `run:` block in
// a YAML file, and nothing reads either one. tests/dev-environment.test.mjs
// proves the docs only invoke npm scripts that exist, and
// tests/e2e-coverage-gate.test.mjs proves the workflow hands the reporter
// thresholds worth clearing -- neither notices when the documented recipe and
// the workflow stop describing the same thing.
//
// The direction asserted is one-way, matching the Justfile contract in
// tests/dev-environment.test.mjs: the docs must be at least as complete as the
// workflow. Documenting more than CI runs is never the bug.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const DEV_DOCS = ['CONTRIBUTING.md', 'AGENTS.md'];

function readDoc(name) {
  return readFileSync(join(repoRoot, name), 'utf8');
}

const workflow = parse(
  readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
);

function workflowRunSteps() {
  const runs = [];
  for (const job of Object.values(workflow?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run === 'string') runs.push(step.run);
    }
  }
  return runs;
}

// Playwright ships the browser bundle and its OS packages separately. The
// bundle alone does not launch: on a clean Debian host
// chrome-headless-shell exits 127 with "error while loading shared libraries:
// libglib-2.0.so.0", and every Playwright test in the repository fails with
// "Target page, context or browser has been closed" rather than with anything
// naming the real cause. ci.yml never hits that because it always installs the
// packages -- `--with-deps` on a cache miss, `install-deps` when the cached
// bundle is restored.
test('the docs install Playwright the way ci.yml does, system packages included', () => {
  const workflowInstallsDeps = workflowRunSteps().some(
    (run) =>
      /npx playwright install\b[^\n]*--with-deps/.test(run) ||
      /npx playwright install-deps\b/.test(run),
  );
  assert.ok(
    workflowInstallsDeps,
    '.github/workflows/ci.yml no longer installs Playwright system dependencies; this contract has nothing left to mirror',
  );

  const incomplete = [];
  for (const doc of DEV_DOCS) {
    const source = readDoc(doc);
    // `install-deps` is a different subcommand and is not a browser install,
    // so it must not satisfy the browser-install match on its own.
    const installs = source.match(/npx playwright install(?!-deps)\b[^\n`]*/g);
    if (!installs) continue;
    const mentionsStandaloneDeps = /npx playwright install-deps\b/.test(source);
    for (const invocation of installs) {
      if (invocation.includes('--with-deps')) continue;
      if (mentionsStandaloneDeps) continue;
      incomplete.push(`${doc}: ${invocation.trim()}`);
    }
  }

  assert.deepEqual(
    incomplete,
    [],
    `developer docs install the Playwright browser without its system packages, so the documented setup cannot launch it:\n${incomplete.join('\n')}`,
  );
});

// `report:e2e:coverage` is a gate, not a readout: the e2e-coverage job hands it
// --check-source, --check-source-regions and --require-source-files, and
// tests/e2e-coverage-gate.test.mjs holds floors under the first two. A recipe
// that omits them renders a report locally that passes where CI fails, which
// is the one thing a contributor runs it to rule out.
function reportGateFlags() {
  const flags = new Set();
  for (const run of workflowRunSteps()) {
    if (!run.includes('report:e2e:coverage')) continue;
    for (const flag of run.match(/--(?:check|require)-[a-z-]+/g) ?? []) {
      flags.add(flag);
    }
  }
  return flags;
}

// The documented command spans several lines inside a fenced block, so the
// flags are read from that block rather than from the file at large: a flag
// named only in the surrounding prose is not something a contributor runs.
function documentedReportCommand(source) {
  const start = source.indexOf('npm run report:e2e:coverage');
  if (start === -1) return null;
  const fence = source.indexOf('```', start);
  return source.slice(start, fence === -1 ? undefined : fence);
}

test('the documented e2e coverage recipe runs the gate ci.yml runs', () => {
  const expected = [...reportGateFlags()].sort();
  assert.ok(
    expected.length > 0,
    '.github/workflows/ci.yml no longer passes threshold flags to report:e2e:coverage; this contract has nothing left to mirror',
  );

  const source = readDoc('CONTRIBUTING.md');
  const documented = documentedReportCommand(source);
  assert.ok(
    documented,
    'CONTRIBUTING.md no longer shows a `npm run report:e2e:coverage` command',
  );

  const missing = expected.filter((flag) => !documented.includes(flag));
  assert.deepEqual(
    missing,
    [],
    `CONTRIBUTING.md's e2e coverage recipe omits the thresholds the e2e-coverage job enforces: ${missing.join(' ')}`,
  );
});
