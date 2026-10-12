// Guards the only evidence a flaky end-to-end spec ever leaves behind.
//
// playwright.config.js sets `retries: 1` and `trace: 'retain-on-failure'` in
// CI. Together those mean a spec that fails, retries and passes exits the job
// green: the 'github' reporter annotates the run, but annotations are not
// artifacts and nothing in the repository records which spec flaked or why.
// The trace Playwright wrote into the output directory for the failed first
// attempt is the whole record, and it only survives if the workflow uploads
// it on a run that *succeeded*. That is what `if: ${{ !cancelled() }}` on
// ci.yml's "Upload Playwright traces" step buys, and it is why that step is
// not `if: failure()` (#1179).
//
// Nothing else in the suite sees it. tests/playwright-config.test.mjs pins
// `retries` and `trace` on the Playwright side but never reads a workflow;
// tests/ci-playwright-setup.test.mjs reads the workflows but only for the
// browser install and its cache; tests/ci-gating-jobs.test.mjs checks that no
// job swallows a failure, which a discarded trace is not. Narrowing the step
// back to `if: failure()` — one word — therefore passes the entire suite while
// making every future flake undiagnosable, which is precisely the regression
// #1179 was opened for.
//
// Three properties make the upload evidence rather than decoration, and each
// can be lost on its own:
//
//   1. the condition survives a green run, or the flake's trace is dropped;
//   2. the uploaded path is Playwright's own output directory, read from
//      playwright.config.js rather than hard-coded here, so renaming
//      `outputDir` fails this test instead of silently uploading nothing;
//   3. a green, non-flaky run — which leaves the output directory empty — does
//      not fail on the missing artifact. Without this the upload turns every
//      clean run red, and the first fix anyone reaches for is to put
//      `if: failure()` back, undoing property 1.
//
// The allowlist below follows the NON_GATING_JOBS convention in
// tests/ci-gating-jobs.test.mjs: a Playwright job that genuinely keeps no
// traces stays possible, but it has to be argued for here rather than ship as
// an omission, and the staleness guard deletes the entry once the job starts
// uploading.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

// `<workflow>#<job>` → why that job keeps no Playwright traces.
const NO_TRACE_JOBS = new Map([
  [
    'ci.yml#e2e-coverage',
    'Runs the suite only to collect V8 coverage and uploads coverage/e2e/ ' +
      'instead; a flake there is diagnosed from the gating e2e job, which ' +
      'runs the same specs against the same build and does keep traces.',
  ],
]);

// Playwright's own default when a config sets no outputDir.
const DEFAULT_OUTPUT_DIR = 'test-results';

// npm scripts that run the Playwright suite. Compared as whole tokens, so
// `test:e2e` does not also claim `test:e2e:coverage`.
const PLAYWRIGHT_TARGETS = new Set(['test:e2e', 'test:e2e:coverage']);

// Conditions under which a step still runs after every preceding step passed.
// An explicit set rather than a predicate: `failure()`, `cancelled()` and
// anything hand-rolled around them are easy to get subtly wrong, so an
// unrecognised condition is reported for a human to classify instead of being
// guessed at.
const SURVIVES_A_GREEN_RUN = new Set(['always()', '!cancelled()']);

// `if-no-files-found` values that leave a green run green. 'error' fails the
// job when the output directory is empty, which is the ordinary shape of a
// run with no flake.
const TOLERATES_NO_FILES = new Set(['warn', 'ignore']);

const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflows = new Map(
  workflowFiles.map((file) => [
    file,
    parse(readFileSync(join(workflowDir, file), 'utf8')),
  ]),
);

const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);

// playwright.config.js reads process.env at module scope; CI is irrelevant to
// outputDir, but the import still has to happen once rather than per test.
const playwrightConfig = (await import('../playwright.config.js')).default;
const outputDir = playwrightConfig.outputDir ?? DEFAULT_OUTPUT_DIR;

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
// Kept in step with the same parser in tests/workflow-scripts.test.mjs.
function npmRunTargets(command) {
  const targets = [];
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

function jobEntries(parsedWorkflows) {
  const entries = [];
  for (const [file, workflow] of parsedWorkflows) {
    for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
      entries.push({ key: `${file}#${name}`, job });
    }
  }
  return entries;
}

// Jobs that invoke a Playwright suite target directly in a `run:` step.
function playwrightJobs(parsedWorkflows) {
  return jobEntries(parsedWorkflows).filter(({ job }) =>
    (job?.steps ?? []).some(
      (step) =>
        typeof step?.run === 'string' &&
        npmRunTargets(step.run).some((target) =>
          PLAYWRIGHT_TARGETS.has(target),
        ),
    ),
  );
}

// An upload-artifact step whose path is Playwright's output directory. Matched
// on the path rather than the artifact name so that renaming the artifact does
// not look like deleting the upload.
function traceUploadSteps(job, dir) {
  return (job?.steps ?? []).filter((step) => {
    if (typeof step?.uses !== 'string') return false;
    if (!step.uses.startsWith('actions/upload-artifact@')) return false;
    const path = step.with?.path;
    if (typeof path !== 'string') return false;
    return path
      .split('\n')
      .map((line) => line.trim().replace(/\/+$/, ''))
      .includes(dir);
  });
}

function normaliseCondition(value) {
  if (value === undefined || value === null) return 'always()';
  return String(value)
    .trim()
    .replace(/^\$\{\{(.*)\}\}$/s, '$1')
    .trim()
    .replace(/\s+/g, ' ');
}

// Every reason a Playwright job's traces do not reach a green run's artifacts.
function traceEvidenceViolations(parsedWorkflows, allowlist, dir) {
  const violations = [];
  for (const { key, job } of playwrightJobs(parsedWorkflows)) {
    if (allowlist.has(key)) continue;
    const uploads = traceUploadSteps(job, dir);
    if (uploads.length === 0) {
      violations.push(`${key} uploads no "${dir}" artifact`);
      continue;
    }
    for (const step of uploads) {
      const condition = normaliseCondition(step.if);
      if (!SURVIVES_A_GREEN_RUN.has(condition)) {
        violations.push(
          `${key} uploads "${dir}" under \`if: ${condition}\`, which does not ` +
            'survive a run whose flaky spec passed on retry',
        );
      }
      const onEmpty = step.with?.['if-no-files-found'] ?? 'warn';
      if (!TOLERATES_NO_FILES.has(String(onEmpty))) {
        violations.push(
          `${key} sets if-no-files-found: ${onEmpty} on "${dir}", which fails ` +
            'every green run that left no trace behind',
        );
      }
    }
  }
  return violations.sort();
}

function staleAllowlistEntries(parsedWorkflows, allowlist, dir) {
  const stale = [];
  const jobs = new Map(playwrightJobs(parsedWorkflows).map((e) => [e.key, e]));
  for (const key of allowlist.keys()) {
    const entry = jobs.get(key);
    if (!entry) {
      stale.push(`${key} (no such job, or it no longer runs the suite)`);
      continue;
    }
    if (traceUploadSteps(entry.job, dir).length > 0) {
      stale.push(`${key} (now uploads traces — delete this entry)`);
    }
  }
  return stale;
}

// Smallest shape the scanners read: one workflow, one job, its steps.
function fixture(jobs) {
  return new Map([['fixture.yml', { jobs }]]);
}

const RUN_SUITE = { run: 'npm run test:e2e' };
const UPLOAD = {
  uses: 'actions/upload-artifact@v7.0.1',
  if: '${{ !cancelled() }}',
  with: { name: 'playwright-traces', path: 'test-results/' },
};

test('the Playwright output directory is read from the config, not assumed', () => {
  // The scanners compare against this value, so a config that stopped naming
  // a directory would quietly make every path comparison vacuous.
  assert.equal(typeof outputDir, 'string');
  assert.ok(outputDir.length > 0, 'playwright outputDir resolved to nothing');
  assert.equal(outputDir, DEFAULT_OUTPUT_DIR);
});

test('ci.yml still runs the Playwright suite in a job this test can see', () => {
  const keys = playwrightJobs(workflows).map(({ key }) => key);
  assert.ok(
    keys.includes('ci.yml#e2e'),
    `ci.yml#e2e no longer runs a Playwright suite target; saw ${keys.join(', ')}`,
  );
  for (const target of PLAYWRIGHT_TARGETS) {
    assert.ok(
      Object.hasOwn(packageJson.scripts ?? {}, target),
      `package.json defines no "${target}" script`,
    );
  }
});

test('every Playwright job keeps the traces a green run produced', () => {
  assert.deepEqual(
    traceEvidenceViolations(workflows, NO_TRACE_JOBS, outputDir),
    [],
    'a flaky spec that passes on retry leaves no artifact behind',
  );
});

test('the no-trace allowlist is argued for and does not outlive its jobs', () => {
  for (const [key, reason] of NO_TRACE_JOBS) {
    assert.ok(
      typeof reason === 'string' && reason.length > 0,
      `allowlist entry ${key} must record why the job keeps no traces`,
    );
  }
  assert.deepEqual(
    staleAllowlistEntries(workflows, NO_TRACE_JOBS, outputDir),
    [],
    'stale entries in NO_TRACE_JOBS',
  );
});

test('a Playwright job with no trace upload at all is reported', () => {
  const parsed = fixture({ e2e: { steps: [RUN_SUITE] } });
  assert.deepEqual(traceEvidenceViolations(parsed, new Map(), outputDir), [
    'fixture.yml#e2e uploads no "test-results" artifact',
  ]);
});

test('a failure-only upload is reported', () => {
  const parsed = fixture({
    e2e: { steps: [RUN_SUITE, { ...UPLOAD, if: 'failure()' }] },
  });
  assert.deepEqual(traceEvidenceViolations(parsed, new Map(), outputDir), [
    'fixture.yml#e2e uploads "test-results" under `if: failure()`, which ' +
      'does not survive a run whose flaky spec passed on retry',
  ]);
});

test('an unconditional upload, however spelled, is accepted', () => {
  for (const condition of [undefined, 'always()', '${{ !cancelled() }}']) {
    const step = { ...UPLOAD };
    if (condition === undefined) delete step.if;
    else step.if = condition;
    const parsed = fixture({ e2e: { steps: [RUN_SUITE, step] } });
    assert.deepEqual(
      traceEvidenceViolations(parsed, new Map(), outputDir),
      [],
      `rejected if: ${condition}`,
    );
  }
});

test('an upload that fails the job on an empty directory is reported', () => {
  const parsed = fixture({
    e2e: {
      steps: [
        RUN_SUITE,
        { ...UPLOAD, with: { ...UPLOAD.with, 'if-no-files-found': 'error' } },
      ],
    },
  });
  assert.deepEqual(traceEvidenceViolations(parsed, new Map(), outputDir), [
    'fixture.yml#e2e sets if-no-files-found: error on "test-results", which ' +
      'fails every green run that left no trace behind',
  ]);
});

test('an upload of some other directory does not count as the trace upload', () => {
  const parsed = fixture({
    e2e: {
      steps: [
        RUN_SUITE,
        { ...UPLOAD, with: { ...UPLOAD.with, path: 'coverage/e2e/' } },
      ],
    },
  });
  assert.deepEqual(traceEvidenceViolations(parsed, new Map(), outputDir), [
    'fixture.yml#e2e uploads no "test-results" artifact',
  ]);
});

test('a multi-line upload path that includes the output directory counts', () => {
  const parsed = fixture({
    e2e: {
      steps: [
        RUN_SUITE,
        {
          ...UPLOAD,
          with: { ...UPLOAD.with, path: 'coverage/e2e/\ntest-results/\n' },
        },
      ],
    },
  });
  assert.deepEqual(traceEvidenceViolations(parsed, new Map(), outputDir), []);
});

test('a job that never runs the suite is out of scope', () => {
  const parsed = fixture({
    lint: { steps: [{ run: 'npm run check:format' }] },
    // A prefix of a suite target is not a suite target.
    other: { steps: [{ run: 'npm run test:unit' }] },
  });
  assert.deepEqual(playwrightJobs(parsed), []);
  assert.deepEqual(traceEvidenceViolations(parsed, new Map(), outputDir), []);
});

test('the coverage suite target is recognised as a Playwright job', () => {
  const parsed = fixture({
    cov: { steps: [{ run: 'npm run test:e2e:coverage' }] },
  });
  assert.deepEqual(
    playwrightJobs(parsed).map(({ key }) => key),
    ['fixture.yml#cov'],
  );
});

test('an allowlisted job is skipped, and the entry goes stale when it uploads', () => {
  const allowlist = new Map([['fixture.yml#e2e', 'because']]);
  const bare = fixture({ e2e: { steps: [RUN_SUITE] } });
  assert.deepEqual(traceEvidenceViolations(bare, allowlist, outputDir), []);
  assert.deepEqual(staleAllowlistEntries(bare, allowlist, outputDir), []);

  const uploading = fixture({ e2e: { steps: [RUN_SUITE, UPLOAD] } });
  assert.deepEqual(staleAllowlistEntries(uploading, allowlist, outputDir), [
    'fixture.yml#e2e (now uploads traces — delete this entry)',
  ]);
});

test('an allowlist entry naming no Playwright job is reported', () => {
  const allowlist = new Map([['fixture.yml#gone', 'because']]);
  const parsed = fixture({ e2e: { steps: [RUN_SUITE, UPLOAD] } });
  assert.deepEqual(staleAllowlistEntries(parsed, allowlist, outputDir), [
    'fixture.yml#gone (no such job, or it no longer runs the suite)',
  ]);
});

test('a workflow with no jobs contributes nothing', () => {
  assert.deepEqual(jobEntries(new Map([['empty.yml', {}]])), []);
  assert.deepEqual(jobEntries(new Map([['null.yml', null]])), []);
});

test('a step with no `uses` or a non-string path is not an upload', () => {
  const job = {
    steps: [
      { run: 'echo hi' },
      { uses: 'actions/checkout@v7.0.1' },
      { uses: 'actions/upload-artifact@v7.0.1' },
      { uses: 'actions/upload-artifact@v7.0.1', with: { path: 42 } },
    ],
  };
  assert.deepEqual(traceUploadSteps(job, outputDir), []);
  assert.deepEqual(traceUploadSteps(null, outputDir), []);
});
