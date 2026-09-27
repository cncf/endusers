// Guards the ordering contract for workflows that generate data: regenerate,
// then format, then validate, then test. The existing wiring guards in
// workflow-scripts.test.mjs ask whether a gate is run by *some* workflow, and
// ci.yml runs every one of them, so those guards stay green no matter how the
// automation jobs are ordered. That is not enough cover, because the jobs that
// actually produce data never reach ci.yml: they open their pull requests with
// `peter-evans/create-pull-request` under `github.token`, and GitHub refuses to
// start `on: pull_request` runs for a token-authored pull request. The steps a
// generating workflow runs itself are therefore the only pre-merge gate its
// output ever passes, and the deploy job is the only post-merge one.
//
// The failures that follow are all silent. A generator that emits unformatted
// JSON produces a pull request no `check:format` ever reads. A unit suite run
// before the generator tests the old data and passes while the new data is
// broken. A dataset refreshed without its validator lands unchecked. A deploy
// job that runs part of the validator set publishes whatever the rest would
// have caught.
//
// Violations that exist today are recorded in KNOWN_ORDERING_VIOLATIONS with
// the issue tracking them, following the GATES_NOT_RUN_BY_CI convention in
// workflow-scripts.test.mjs: the contract binds any workflow added from here
// on, and the staleness guard at the bottom forces each entry to be deleted as
// its workflow is fixed, so the table cannot quietly outlive the problem.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

const scripts =
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts ??
  {};

const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

// Every violation the repository is currently carrying, keyed
// `<workflow>:<rule>`. Delete an entry when its workflow is fixed; the
// staleness guard below fails if one is left behind.
const KNOWN_ORDERING_VIOLATIONS = new Map([
  [
    'import-architectures.yml:unit-suite-after-generators',
    'Runs `test:unit` before `collect:metrics` and `import:architectures`, so ' +
      'the suite only ever sees the previous run\u2019s data. Tracked by #755.',
  ],
  [
    'refresh-radar-reports.yml:unit-suite-after-generators',
    'Runs `test:unit` before `collect:radar-reports`, so the suite only ever ' +
      'sees the previous run\u2019s data. Tracked by #755.',
  ],
  [
    'import-architectures.yml:format-generated-output',
    'Never runs `check:format`, so every import pull request carries ' +
      'unformatted generated files. Tracked by #755.',
  ],
  [
    'refresh-community-people.yml:format-generated-output',
    'Never runs `check:format` on the refreshed profile data. Tracked by #755.',
  ],
  [
    'refresh-radar-reports.yml:format-generated-output',
    'Never runs `check:format` on the refreshed radar data. Tracked by #755.',
  ],
  [
    'refresh-community-people.yml:validate-generated-dataset',
    'Commits third-party profile data without running ' +
      '`validate:community-people`. Tracked by #755.',
  ],
  [
    'deploy-gh-pages.yml:publish-runs-every-gate',
    'Publishes after running 4 of the 11 `validate:*` gates. Because ' +
      'automation pull requests never trigger ci.yml, this job is the only ' +
      'gate their data passes. Tracked by #755.',
  ],
]);

// A script that writes data into the repository, as opposed to one that reads
// it. Matched on the package.json namespaces the repository already uses for
// that job rather than on a hand-kept list of names, so a new collector is
// bound by this contract the moment it is added.
const GENERATOR_NAMESPACES = ['collect:', 'fetch:', 'import:', 'generate:'];

function parseWorkflow(file) {
  return parse(readFileSync(join(workflowDir, file), 'utf8'));
}

// Ordering only means something inside a single job: separate jobs run
// concurrently unless `needs` sequences them, so comparing step positions
// across jobs would compare things that never had an order.
function jobsOf(file) {
  return Object.entries(parseWorkflow(file)?.jobs ?? {});
}

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
function npmRunTargets(command) {
  const targets = [];
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

// The package.json scripts a job runs, in the order its steps run them.
function orderedTargets(job) {
  const targets = [];
  for (const step of job?.steps ?? []) {
    if (typeof step?.run !== 'string') continue;
    for (const target of npmRunTargets(step.run)) targets.push(target);
  }
  return targets;
}

function actionsUsedBy(file) {
  const used = [];
  for (const [, job] of jobsOf(file)) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.uses === 'string') used.push(step.uses);
    }
  }
  return used;
}

function isGenerator(target) {
  return (
    target in scripts &&
    GENERATOR_NAMESPACES.some((namespace) => target.startsWith(namespace))
  );
}

// `test:unit` is not the only spelling of the unit suite: `test:unit:coverage`
// runs the same files through the same runner, and `test` runs `check` plus
// `test:unit`. Recognising only the literal name would read a workflow running
// a stricter variant as skipping the suite.
function runsUnitSuite(target) {
  return (
    target === 'test' ||
    target === 'test:unit' ||
    target.startsWith('test:unit:')
  );
}

// The validator that guards what a generator writes, derived from the shared
// suffix (`collect:metrics` -> `validate:metrics`). Returns undefined when the
// dataset has no validator, which is a gap in the validator set rather than an
// ordering fault and so is not this file's to report.
function validatorFor(generator) {
  const suffix = generator.slice(generator.indexOf(':') + 1);
  const validator = `validate:${suffix}`;
  return validator in scripts ? validator : undefined;
}

function lastIndexWhere(targets, predicate) {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    if (predicate(targets[index])) return index;
  }
  return -1;
}

function firstIndexWhere(targets, predicate) {
  return targets.findIndex(predicate);
}

// A workflow that opens a pull request out of what it just generated. Detected
// by the action it uses rather than by filename, so a renamed or newly added
// automation job is covered without editing this file.
function commitsGeneratedOutput(file) {
  return actionsUsedBy(file).some((uses) =>
    uses.startsWith('peter-evans/create-pull-request'),
  );
}

// The workflow that publishes the site. Detected by the deploy actions it
// uses, for the same reason.
function publishesSite(file) {
  return actionsUsedBy(file).some(
    (uses) =>
      uses.startsWith('actions/deploy-pages') ||
      uses.startsWith('actions/upload-pages-artifact'),
  );
}

function validatorGates() {
  return Object.keys(scripts)
    .filter((name) => name.startsWith('validate:'))
    .sort();
}

// Recomputes every violation in the repository, keyed the same way as
// KNOWN_ORDERING_VIOLATIONS. Each rule test below reports the offenders it
// owns that are not recorded; the staleness test uses the whole set.
function currentViolations() {
  const violations = new Map();
  const record = (file, rule, detail) =>
    violations.set(`${file}:${rule}`, detail);

  for (const file of workflowFiles) {
    for (const [, job] of jobsOf(file)) {
      const targets = orderedTargets(job);
      const lastGenerator = lastIndexWhere(targets, isGenerator);
      if (lastGenerator === -1) continue;

      const unitSuite = firstIndexWhere(targets, runsUnitSuite);
      if (unitSuite !== -1 && unitSuite < lastGenerator) {
        record(
          file,
          'unit-suite-after-generators',
          `runs ${targets[unitSuite]} before ${targets[lastGenerator]}`,
        );
      }

      if (commitsGeneratedOutput(file)) {
        const format = firstIndexWhere(
          targets,
          (target) => target === 'check:format',
        );
        if (format === -1 || format < lastGenerator) {
          record(
            file,
            'format-generated-output',
            format === -1
              ? 'commits generated files without running check:format'
              : `runs check:format before ${targets[lastGenerator]}`,
          );
        }
      }

      for (let index = 0; index < targets.length; index += 1) {
        if (!isGenerator(targets[index])) continue;
        const validator = validatorFor(targets[index]);
        if (!validator) continue;
        const validated = targets.some(
          (target, at) => target === validator && at > index,
        );
        if (!validated) {
          record(
            file,
            'validate-generated-dataset',
            `runs ${targets[index]} without ${validator} after it`,
          );
        }
      }
    }
  }

  for (const file of workflowFiles.filter(publishesSite)) {
    const targets = new Set(
      jobsOf(file).flatMap(([, job]) => orderedTargets(job)),
    );
    const missing = validatorGates().filter((gate) => !targets.has(gate));
    if (missing.length > 0) {
      record(
        file,
        'publish-runs-every-gate',
        `publishes without ${missing.join(', ')}`,
      );
    }
  }

  return violations;
}

function unrecorded(rule) {
  return [...currentViolations()]
    .filter(([key]) => key.endsWith(`:${rule}`))
    .filter(([key]) => !KNOWN_ORDERING_VIOLATIONS.has(key))
    .map(([key, detail]) => `${key} (${detail})`)
    .sort();
}

test('the unit suite runs after the generators, not before them', () => {
  assert.deepEqual(
    unrecorded('unit-suite-after-generators'),
    [],
    'workflows running the unit suite before the data it guards is ' +
      'regenerated; move the suite after the generator steps',
  );
});

test('generated output is formatted before it is committed', () => {
  assert.deepEqual(
    unrecorded('format-generated-output'),
    [],
    'workflows opening a pull request out of generated files without ' +
      'running check:format after generating them',
  );
});

test('every regenerated dataset is validated in the same job', () => {
  assert.deepEqual(
    unrecorded('validate-generated-dataset'),
    [],
    'workflows regenerating a dataset without running its validator ' +
      'afterwards',
  );
});

test('the publishing workflow runs every validator gate', () => {
  assert.deepEqual(
    unrecorded('publish-runs-every-gate'),
    [],
    'the deploy job publishes data that only it can gate, because ' +
      'token-authored automation pull requests never trigger ci.yml',
  );
});

test('every recorded violation still describes a real one', () => {
  // Without this the table would absorb the fix as well as the fault: an
  // entry left behind after its workflow was corrected would keep excusing a
  // regression that reintroduced it.
  const current = currentViolations();
  const stale = [...KNOWN_ORDERING_VIOLATIONS.keys()]
    .filter((key) => !current.has(key))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'KNOWN_ORDERING_VIOLATIONS entries whose workflow no longer violates the ' +
      'contract; delete these entries',
  );
});

test('every recorded violation carries a reason', () => {
  const unexplained = [...KNOWN_ORDERING_VIOLATIONS.entries()]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([key]) => key)
    .sort();
  assert.deepEqual(
    unexplained,
    [],
    'violations recorded without saying what is wrong or what tracks it',
  );
});

test('the generator and validator detection is not vacuous', () => {
  // Pins the guards above to evidence rather than to spelling. Every check in
  // this file is driven by these two predicates, so if either stopped matching
  // anything the whole suite would pass while asserting nothing.
  const generators = Object.keys(scripts).filter(isGenerator).sort();
  assert.ok(
    generators.includes('collect:metrics') &&
      generators.includes('fetch:community-people') &&
      generators.includes('import:architectures'),
    `expected the known generators to be recognised, got ${generators.join(', ')}`,
  );
  assert.equal(validatorFor('collect:metrics'), 'validate:metrics');
  assert.equal(
    validatorFor('fetch:community-people'),
    'validate:community-people',
  );
  // `generate:members` has no `validate:members`; the derivation must report
  // that rather than inventing a gate and failing every workflow that runs it.
  assert.equal(validatorFor('generate:members'), undefined);
});

test('the workflows this contract applies to are actually detected', () => {
  // The rules are scoped by what a workflow does, so a detector that silently
  // matched nothing would narrow the contract to the empty set.
  assert.deepEqual(workflowFiles.filter(publishesSite), [
    'deploy-gh-pages.yml',
  ]);
  assert.deepEqual(workflowFiles.filter(commitsGeneratedOutput), [
    'import-architectures.yml',
    'refresh-community-people.yml',
    'refresh-radar-reports.yml',
  ]);
});
