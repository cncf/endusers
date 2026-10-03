// Guards the wiring contract between package.json `scripts`, the files under
// scripts/, the config files those scripts pass to their linters, and the
// `npm run` invocations inside .github/workflows/. Every reference here is a
// plain string in one file that has to name something real in another file,
// so nothing in the existing suite catches a rename or a deletion: the break
// only shows up when CI or a contributor actually runs the command.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const scripts = packageJson.scripts ?? {};

const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

// Collects every `run:` string across jobs.*.steps[] of one workflow.
function runCommands(workflowFile) {
  const parsed = parse(readFileSync(join(workflowDir, workflowFile), 'utf8'));
  const commands = [];
  for (const job of Object.values(parsed?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run === 'string') commands.push(step.run);
    }
  }
  return commands;
}

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
function npmRunTargets(command) {
  const targets = [];
  // A bare `npm run --loglevel=warn` lists scripts rather than running one,
  // so the captured target must not itself look like a flag.
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

test('every workflow parses as YAML and declares at least one job', () => {
  assert.ok(workflowFiles.length > 0, 'no workflow files found');
  for (const file of workflowFiles) {
    const parsed = parse(readFileSync(join(workflowDir, file), 'utf8'));
    assert.ok(
      Object.keys(parsed?.jobs ?? {}).length > 0,
      `${file} declares no jobs`,
    );
  }
});

// GitHub silently drops a job-level `if:` that references a context it
// doesn't expose there rather than failing loudly: `env` (populated only once
// a job's steps start running) isn't among them, so `jobs.<id>.if` referencing
// it never evaluates truthy and the job never runs, on any trigger. This bit
// #813: an `architecture-ready` label never started the submission job.
// https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability
function envContextJobs(parsed) {
  return Object.entries(parsed?.jobs ?? {})
    .filter(([, job]) => typeof job?.if === 'string' && /\benv\./.test(job.if))
    .map(([jobName]) => jobName);
}

test('no job-level `if:` references the env context', () => {
  const offenders = workflowFiles.flatMap((file) =>
    envContextJobs(parse(readFileSync(join(workflowDir, file), 'utf8'))).map(
      (jobName) => `${file}:${jobName}`,
    ),
  );
  assert.deepEqual(
    offenders,
    [],
    'job-level `if:` cannot see the env context; inline the literal instead',
  );
});

test('every `npm run` in a workflow names a defined package.json script', () => {
  const missing = [];
  for (const file of workflowFiles) {
    for (const command of runCommands(file)) {
      for (const target of npmRunTargets(command)) {
        if (!(target in scripts)) missing.push(`${file}: npm run ${target}`);
      }
    }
  }
  assert.deepEqual(missing, [], `undefined scripts invoked by workflows`);
});

test('every `npm run` inside a package.json script names a defined script', () => {
  const missing = [];
  for (const [name, body] of Object.entries(scripts)) {
    for (const target of npmRunTargets(body)) {
      // The `_list:*` helpers shell out to `npm run` with no argument to
      // enumerate scripts, and `npm run seq -- $(...)` expands at runtime;
      // a literal glob is not a script name.
      if (target.includes('*')) continue;
      if (!(target in scripts)) missing.push(`${name}: npm run ${target}`);
    }
  }
  assert.deepEqual(missing, [], 'undefined scripts invoked by other scripts');
});

// `node scripts/...` and `-c .dotfile` references, paired with the script that
// names them. Collecting references separately from resolving them is what
// lets the reporting arm below be driven by a test: the repository is expected
// to resolve every reference, so a guard that only ever scans the real tree
// never executes the branch that reports a broken one.
function scriptFileRefs(scriptBodies) {
  return referencesMatching(scriptBodies, /\bnode\s+(scripts\/[\w./-]+)/g);
}

function linterConfigRefs(scriptBodies) {
  return referencesMatching(
    scriptBodies,
    /(?:^|\s)(?:-c|--config)\s+(\.[\w.-]+)/g,
  );
}

function referencesMatching(scriptBodies, pattern) {
  const refs = [];
  for (const [name, body] of Object.entries(scriptBodies)) {
    for (const match of body.matchAll(pattern)) {
      refs.push({ name, path: match[1] });
    }
  }
  return refs;
}

function unresolved(refs, exists) {
  return refs
    .filter(({ path }) => !exists(path))
    .map(({ name, path }) => `${name} -> ${path}`);
}

const onDisk = (path) => existsSync(join(repoRoot, path));

test('every `node scripts/...` target in package.json exists on disk', () => {
  assert.deepEqual(
    unresolved(scriptFileRefs(scripts), onDisk),
    [],
    'package.json scripts point at missing files',
  );
});

test('every config file passed to a linter in package.json exists', () => {
  // A missing dotfile here makes `npm run check` fail on a fresh clone while
  // every unit test still passes, because no test runs the linters.
  assert.deepEqual(
    unresolved(linterConfigRefs(scripts), onDisk),
    [],
    'linter config files referenced but absent',
  );
});

// The three guards above pass by finding nothing, so on a healthy repository
// their reporting arms never execute and nothing proves they would fire. Each
// case below drives one detector with a synthetic input carrying the exact
// defect it exists to catch, and with a clean one, so a detector that silently
// stopped matching fails here instead of passing everywhere.
test('the env-context guard names the job whose `if:` reads env', () => {
  // The shape of #813: a job gated on a label it reads through `env`, which
  // GitHub does not expose to `jobs.<id>.if`.
  const broken = parse(`
jobs:
  import:
    if: contains(github.event.pull_request.labels.*.name, env.READY_LABEL)
    runs-on: ubuntu-24.04
  unrelated:
    runs-on: ubuntu-24.04
`);
  assert.deepEqual(envContextJobs(broken), ['import']);

  const fixed = parse(`
jobs:
  import:
    if: contains(github.event.pull_request.labels.*.name, 'architecture-ready')
    runs-on: ubuntu-24.04
`);
  assert.deepEqual(envContextJobs(fixed), []);
  assert.deepEqual(envContextJobs({}), []);
});

test('the reference guards report a reference that resolves to nothing', () => {
  const synthetic = {
    'collect:metrics': 'node scripts/collect-metrics.mjs',
    'check:spelling': 'npx cspell --no-progress -c .cspell.yml docs *.md',
    build: 'BUILD_ENV=dev npm run _build',
  };

  assert.deepEqual(scriptFileRefs(synthetic), [
    { name: 'collect:metrics', path: 'scripts/collect-metrics.mjs' },
  ]);
  assert.deepEqual(linterConfigRefs(synthetic), [
    { name: 'check:spelling', path: '.cspell.yml' },
  ]);

  // Nothing on disk: every reference is reported, with the script that made it.
  assert.deepEqual(
    unresolved(scriptFileRefs(synthetic), () => false),
    ['collect:metrics -> scripts/collect-metrics.mjs'],
  );
  assert.deepEqual(
    unresolved(linterConfigRefs(synthetic), () => false),
    ['check:spelling -> .cspell.yml'],
  );

  // Everything on disk: the same inputs report nothing, so the arm above is
  // the resolver answering rather than the scanner matching indiscriminately.
  assert.deepEqual(
    unresolved(scriptFileRefs(synthetic), () => true),
    [],
  );
  assert.deepEqual(
    unresolved(linterConfigRefs(synthetic), () => true),
    [],
  );
});

test('every scripts/*.mjs entry point is reachable from a package.json script', () => {
  const referenced = new Set();
  for (const body of Object.values(scripts)) {
    for (const match of body.matchAll(/\bnode\s+(scripts\/[\w./-]+)/g)) {
      referenced.add(match[1]);
    }
  }
  const orphans = readdirSync(join(repoRoot, 'scripts'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `scripts/${name}`)
    .filter((path) => !referenced.has(path));
  assert.deepEqual(
    orphans,
    [],
    'scripts/ entry points no package.json script can run',
  );
});

// `test:unit` is not the only way to run the unit suite: `test:unit:coverage`
// runs the same `node --test` over the same files and additionally reports
// coverage, and `test` runs `check` plus `test:unit`. A guard that recognises
// only the literal `test:unit` reads a workflow running the coverage variant
// as skipping the suite entirely, so it would fail a workflow that is in fact
// stricter than the one it was written for.
function runsUnitSuite(target) {
  return (
    target === 'test' ||
    target === 'test:unit' ||
    target.startsWith('test:unit:')
  );
}

test('every script this suite accepts as the unit suite really runs node --test', () => {
  // Pins the allowance above to evidence rather than to a name: a future
  // `test:unit:smoke` that quietly stops running the suite must not satisfy
  // the validator guard just because of how it is spelled.
  const accepted = Object.keys(scripts).filter(runsUnitSuite);
  assert.ok(
    accepted.includes('test:unit') && accepted.includes('test:unit:coverage'),
    `expected both unit-suite scripts to be recognised, got ${accepted.join(', ')}`,
  );
  const notRunningTests = [];
  for (const name of accepted) {
    // Follow one level of `npm run` indirection, then look for the runner.
    const bodies = [
      scripts[name],
      ...npmRunTargets(scripts[name]).map((t) => scripts[t] ?? ''),
    ];
    const invokesRunner = bodies.some((body) => {
      if (/\bnode\s+--test\b/.test(body)) return true;
      // `node tests/tools/coverage-report.mjs` spawns `node --test` itself.
      const tool = body.match(/\bnode\s+(tests\/[\w./-]+)/)?.[1];
      if (!tool || !existsSync(join(repoRoot, tool))) return false;
      return /'--test'|"--test"/.test(
        readFileSync(join(repoRoot, tool), 'utf8'),
      );
    });
    if (!invokesRunner) notRunningTests.push(name);
  }
  assert.deepEqual(
    notRunningTests,
    [],
    'scripts accepted as the unit suite that never reach node --test',
  );
});

test('the unit suite runs in every workflow that runs a validator', () => {
  // A workflow that validates data but skips the unit suite can publish a
  // regression the suite would have caught.
  const offenders = [];
  for (const file of workflowFiles) {
    const targets = runCommands(file).flatMap(npmRunTargets);
    const runsValidator = targets.some((t) => t.startsWith('validate:'));
    if (runsValidator && !targets.some(runsUnitSuite)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    'workflows validating data without the unit suite',
  );
});

test('the Playwright end-to-end suite runs in some workflow', () => {
  // Regression for #672: tests/e2e/ existed, wired as `npm run test:e2e`,
  // and no workflow ever ran it, so it contributed no CI signal and could
  // break, bit-rot, or start asserting stale behaviour silently.
  const runsIt = workflowFiles.some((file) =>
    runCommands(file).flatMap(npmRunTargets).includes('test:e2e'),
  );
  assert.ok(runsIt, 'no workflow runs `npm run test:e2e`');
});

test('browser coverage is isolated in a visible gating job with a source floor', () => {
  const workflow = parse(readFileSync(join(workflowDir, 'ci.yml'), 'utf8'));
  const required = workflow.jobs?.e2e;
  const coverage = workflow.jobs?.['e2e-coverage'];
  assert.ok(required, 'required e2e job is missing');
  assert.ok(coverage, 'e2e coverage job is missing');
  // #990: the reporter supports --check-source, but an unwired threshold and a
  // continue-on-error job meant browser coverage was measured and never
  // enforced. The job must fail the run, and the report command must carry
  // the floor, or the gate is a summary nobody has to read.
  assert.equal(
    coverage['continue-on-error'],
    undefined,
    'e2e-coverage must gate the run; see ci-gating-jobs.test.mjs',
  );

  const coverageCommands = (coverage.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string')
    .join('\n');
  assert.match(coverageCommands, /npm run build:e2e:coverage/);
  assert.match(coverageCommands, /npm run test:e2e:coverage/);
  assert.match(coverageCommands, /npm run report:e2e:coverage/);
  assert.match(
    coverageCommands,
    /--check-source\s+100\b/,
    'the e2e coverage report must gate on --check-source 100',
  );

  const requiredCoverageEnv = (required.steps ?? []).some(
    (step) => step.env?.E2E_COVERAGE !== undefined,
  );
  assert.equal(
    requiredCoverageEnv,
    false,
    'required e2e job must keep default coverage disabled',
  );

  const deploy = readFileSync(join(workflowDir, 'deploy-gh-pages.yml'), 'utf8');
  assert.doesNotMatch(
    deploy,
    /\bE2E_COVERAGE\b/,
    'deployment must not opt into browser source maps',
  );
});

// The `validate:*` and `check:*` scripts are the repository's gates: one set
// rejects data that would ship to the site, the other rejects the repository
// itself. Defining a gate is only half the wiring. Unless a workflow runs it,
// the gate is inert — it keeps passing when a contributor runs it by hand, the
// unit suite stays green, and the breakage it was written to catch reaches main
// anyway. None of the guards above notice, because each one only asks whether
// the names resolve, never whether anything invokes them.
//
// Leaving a gate out of CI is allowed, but it has to be a decision on the
// record. Every omission is listed here with its reason, so a gate that fell
// out of a workflow is distinguishable from one that was never meant to be in
// one.
const GATES_NOT_RUN_BY_CI = new Map([
  [
    'check:links',
    'markdown-link-check resolves every outbound URL against the live ' +
      'internet, so a third-party outage would fail unrelated pull requests.',
  ],
  [
    'check:community-group-links',
    'calls the GitHub API and requires GH_TOKEN; it also rewrites ' +
      'data/community-groups.json, which is a refresh job rather than a check ' +
      'a pull request can pass or fail.',
  ],
]);

function gateScripts() {
  return Object.keys(scripts)
    .filter((name) => /^(?:validate|check):/.test(name))
    .sort();
}

function workflowRunTargets() {
  const targets = new Set();
  for (const file of workflowFiles) {
    for (const command of runCommands(file)) {
      for (const target of npmRunTargets(command)) targets.add(target);
    }
  }
  return targets;
}

test('every validate:*/check:* gate is run by a workflow or recorded as exempt', () => {
  const targets = workflowRunTargets();
  const ungated = gateScripts().filter(
    (name) => !targets.has(name) && !GATES_NOT_RUN_BY_CI.has(name),
  );
  assert.deepEqual(
    ungated,
    [],
    'gates defined in package.json that no workflow runs; either add a step ' +
      'for them or record the omission in GATES_NOT_RUN_BY_CI with a reason',
  );
});

test('every gate this suite recognises is a real package.json script', () => {
  // Pins the guard above to evidence rather than to spelling: if the filter
  // stopped matching anything, the assertion would pass vacuously.
  const gates = gateScripts();
  assert.ok(
    gates.includes('validate:metrics') && gates.includes('check:format'),
    `expected the known gates to be recognised, got ${gates.join(', ')}`,
  );
});

test('every recorded CI exemption still names a defined script', () => {
  const stale = [...GATES_NOT_RUN_BY_CI.keys()].filter(
    (name) => !(name in scripts),
  );
  assert.deepEqual(
    stale,
    [],
    'GATES_NOT_RUN_BY_CI names scripts package.json no longer defines',
  );
});

test('every recorded CI exemption carries a reason', () => {
  const unexplained = [...GATES_NOT_RUN_BY_CI.entries()]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([name]) => name);
  assert.deepEqual(
    unexplained,
    [],
    'exemptions recorded without saying why the gate is not run in CI',
  );
});

test('no recorded CI exemption names a gate a workflow already runs', () => {
  // An exemption that is no longer true reads as a standing decision not to
  // gate something CI does in fact gate, and would silently absorb a later
  // removal of that step.
  const targets = workflowRunTargets();
  const contradicted = [...GATES_NOT_RUN_BY_CI.keys()].filter((name) =>
    targets.has(name),
  );
  assert.deepEqual(
    contradicted,
    [],
    'exemptions for gates a workflow runs; delete these entries',
  );
});
