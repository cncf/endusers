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
import { parse } from 'yaml';

import {
  jobEntries,
  loadWorkflows,
  repoRoot,
  runCommands,
} from './helpers-workflows.mjs';

const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const scripts = packageJson.scripts ?? {};

const workflows = loadWorkflows();

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
  assert.ok(workflows.length > 0, 'no workflow files found');
  for (const { name, doc } of workflows) {
    assert.ok(jobEntries(doc).length > 0, `${name} declares no jobs`);
  }
});

// GitHub silently drops a job-level `if:` that references a context it
// doesn't expose there rather than failing loudly: `env` (populated only once
// a job's steps start running) isn't among them, so `jobs.<id>.if` referencing
// it never evaluates truthy and the job never runs, on any trigger. This bit
// #813: an `architecture-ready` label never started the submission job.
// https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability
function envContextJobs(parsed) {
  return jobEntries(parsed)
    .filter(([, job]) => typeof job?.if === 'string' && /\benv\./.test(job.if))
    .map(([jobName]) => jobName);
}

test('no job-level `if:` references the env context', () => {
  const offenders = workflows.flatMap(({ name, doc }) =>
    envContextJobs(doc).map((jobName) => `${name}:${jobName}`),
  );
  assert.deepEqual(
    offenders,
    [],
    'job-level `if:` cannot see the env context; inline the literal instead',
  );
});

test('every `npm run` in a workflow names a defined package.json script', () => {
  const missing = [];
  for (const { name, doc } of workflows) {
    for (const command of runCommands(doc)) {
      for (const target of npmRunTargets(command)) {
        if (!(target in scripts)) missing.push(`${name}: npm run ${target}`);
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
  for (const { name, doc } of workflows) {
    const targets = runCommands(doc).flatMap(npmRunTargets);
    const runsValidator = targets.some((t) => t.startsWith('validate:'));
    if (runsValidator && !targets.some(runsUnitSuite)) offenders.push(name);
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
  const runsIt = workflows.some(({ doc }) =>
    runCommands(doc).flatMap(npmRunTargets).includes('test:e2e'),
  );
  assert.ok(runsIt, 'no workflow runs `npm run test:e2e`');
});

test('browser coverage is isolated in a visible gating job with a source floor', () => {
  const workflow = workflows.find(({ name }) => name === 'ci.yml').doc;
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
  // #1026: the line map folds every statement on a line to one bit, so an
  // uncovered ternary arm or short-circuit that shares a line with covered
  // code is invisible to --check-source. The region floor is the granularity
  // the line gate cannot give. The gate landed at 80, just under the 81.43%
  // a full run of the suite measured at the time, was ratcheted to 91
  // under the 91.63% measured after the 2026-10-07 coverage merges (#1105),
  // to 95 under the 95.22% measured after #1163 folded the crossing-region
  // source-map drift (#1079), and to 96 under the 97.26% measured when the
  // per-file floor landed (#1232) -- the same ratchet pattern as the unit
  // lane's region floors.
  assert.match(
    coverageCommands,
    /--check-source-regions\s+96\b/,
    'the e2e coverage report must gate on --check-source-regions 96',
  );
  // #1232 added a per-file floor here so the aggregate could not let its slack
  // concentrate in one file. It was removed in #1593: the browser lane's
  // per-file region counts carry a cross-build attribution artifact that left
  // files with every arm executed sitting on the floor, and the unit lane
  // already holds --check-source-file-regions 100 on the same files.
  assert.doesNotMatch(
    coverageCommands,
    /--check-source-file-regions/,
    'the e2e coverage report must not gate per file; that floor measures a reporting artifact (#1593)',
  );
  // #992: the ratio is computed over observed files only, so a src module the
  // bundle drops vanishes from numerator and denominator alike. The file-set
  // gate is the guarantee the percentage cannot give.
  assert.match(
    coverageCommands,
    /--require-source-files\b/,
    'the e2e coverage report must fail on a src file the run never measured',
  );

  const requiredCoverageEnv = (required.steps ?? []).some(
    (step) => step.env?.E2E_COVERAGE !== undefined,
  );
  assert.equal(
    requiredCoverageEnv,
    false,
    'required e2e job must keep default coverage disabled',
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
    'validate:all',
    'The aggregate the Netlify build runs (netlify.toml -> build:netlify -> ' +
      'scripts/netlify-build.mjs), not a gate of its own; every validator it ' +
      'chains is run individually by ci.yml, and ' +
      'tests/netlify-publish-contract.test.mjs pins that parity.',
  ],
  [
    'validate:end-user-talks',
    'Exists for the Netlify publish path, which runs validate:all and no ' +
      'unit tests; the PR lane already enforces the same link allow-list ' +
      'through tests/end-user-talks-data.test.mjs under npm run test:unit, ' +
      'so a separate ci.yml step would only run the contract a second time.',
  ],
]);

function gateScripts() {
  return Object.keys(scripts)
    .filter((name) => /^(?:validate|check):/.test(name))
    .sort();
}

function workflowRunTargets() {
  const targets = new Set();
  for (const { doc } of workflows) {
    for (const command of runCommands(doc)) {
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

// The `collect:*` and `fetch:*` scripts are the other half of the data
// contract. The gate guard above asks whether every `validate:*`/`check:*`
// script is run by a workflow, because a gate nobody runs rejects nothing.
// The mirror question is never asked: a collector nobody runs *refreshes*
// nothing. data/*.json then keeps validating cleanly against its schema while
// drifting further from the upstream it mirrors, which is the one failure mode
// no validator can see — the file is still well-formed, just wrong.
//
// Nothing else in the suite notices. The guards above only ask whether the
// names resolve; `tests/automation-workflow-ordering.test.mjs` pins the step
// order *inside* the refresh workflows that exist, so a collector that has no
// workflow at all is simply absent from everything it checks.
//
// Scope is deliberately the scripts that pull from an upstream source. The
// `generate:*` scripts derive from data already in the tree and are chained
// from other package.json scripts (`generate:changelog` from `_build`), so
// "which workflow runs it" is not the right question for them; the existing
// 'every `npm run` inside a package.json script names a defined script' guard
// is what covers that chaining.
const REFRESH_SCRIPT_PATTERN = /^(?:collect|fetch):/;

// `<script>` → why no workflow refreshes it. Same bargain as
// GATES_NOT_RUN_BY_CI: staying manual is allowed, but it has to be a decision
// on the record rather than an omission nobody can distinguish from a
// regression.
const REFRESH_SCRIPTS_NOT_RUN_BY_CI = new Map([
  [
    'collect:case-studies',
    'No scheduled workflow exists yet; scripts/collect-case-studies.mjs says ' +
      'so in its own header and documents `npm run collect:case-studies` as ' +
      'the manual refresh for data/case-studies.json.',
  ],
  [
    'collect:end-user-talks',
    'A snapshot of one event schedule (Sessionize, KubeCon NA 2026) rather ' +
      'than a continuously moving upstream; scripts/collect-end-user-talks.mjs ' +
      'documents `npm run collect:end-user-talks` as the manual refresh.',
  ],
  [
    'collect:launch-metrics',
    'A point-in-time capture, not a feed: scripts/collect-launch-metrics.mjs ' +
      'records the launch-day baseline the 90-day comparison measures from, ' +
      'so a schedule would overwrite the very baseline it exists to preserve.',
  ],
]);

function refreshScripts() {
  return Object.keys(scripts).filter((name) =>
    REFRESH_SCRIPT_PATTERN.test(name),
  );
}

test('every collect:*/fetch:* refresh is run by a workflow or recorded as exempt', () => {
  const targets = workflowRunTargets();
  const unrefreshed = refreshScripts()
    .filter(
      (name) => !targets.has(name) && !REFRESH_SCRIPTS_NOT_RUN_BY_CI.has(name),
    )
    .sort();
  assert.deepEqual(
    unrefreshed,
    [],
    'collectors package.json defines that no workflow runs; either add a ' +
      'refresh workflow step for them or record the omission in ' +
      'REFRESH_SCRIPTS_NOT_RUN_BY_CI with a reason',
  );
});

test('the refresh guard recognises the collectors that are wired up', () => {
  // Pins the guard above to evidence rather than to spelling, the way
  // 'every gate this suite recognises is a real package.json script' does: a
  // pattern that stopped matching would make the assertion pass vacuously.
  const refreshes = refreshScripts();
  const targets = workflowRunTargets();
  for (const name of ['collect:metrics', 'fetch:community-people']) {
    assert.ok(
      refreshes.includes(name),
      `expected ${name} to be recognised as a refresh script, got ${refreshes.join(', ')}`,
    );
    assert.ok(
      targets.has(name),
      `expected a workflow to run ${name}; if it was removed, the guard above ` +
        'has lost the evidence that it can see a wired-up collector',
    );
  }
});

test('every recorded refresh exemption still names a defined script', () => {
  const stale = [...REFRESH_SCRIPTS_NOT_RUN_BY_CI.keys()].filter(
    (name) => !(name in scripts),
  );
  assert.deepEqual(
    stale,
    [],
    'REFRESH_SCRIPTS_NOT_RUN_BY_CI names scripts package.json no longer defines',
  );
});

test('every recorded refresh exemption carries a reason', () => {
  const unexplained = [...REFRESH_SCRIPTS_NOT_RUN_BY_CI.entries()]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([name]) => name);
  assert.deepEqual(
    unexplained,
    [],
    'exemptions recorded without saying why the collector is not refreshed in CI',
  );
});

test('no recorded refresh exemption names a collector a workflow already runs', () => {
  // An exemption that is no longer true reads as a standing decision to leave
  // something manual that CI does in fact refresh, and would silently absorb a
  // later removal of that step.
  const targets = workflowRunTargets();
  const contradicted = [...REFRESH_SCRIPTS_NOT_RUN_BY_CI.keys()]
    .filter((name) => targets.has(name))
    .sort();
  assert.deepEqual(
    contradicted,
    [],
    'exemptions for collectors a workflow runs; delete these entries',
  );
});

// Both exemption maps above argue their case by naming another file: the
// end-user-talks gate rests on tests/end-user-talks-data.test.mjs enforcing the
// same link allow-list in the pull-request lane, and each recorded collector
// points at the scripts/ header that documents its manual refresh. Those
// citations are the whole of what makes an omission a decision rather than a
// gap, and nothing reads them.
//
// That is not hypothetical bookkeeping. Rename or delete
// tests/end-user-talks-data.test.mjs and the pull-request lane loses the
// end-user-talks link allow-list outright -- no ci.yml step runs
// validate:end-user-talks, because the exemption says it would duplicate that
// test -- while every guard above stays green: the key is still a defined
// script, the reason is still non-empty, and no workflow contradicts it. The
// recorded decision survives the evidence it rested on.
//
// So the same bargain the guards above strike over an exemption's key is
// struck here over its reason: cite whatever argues the case, but a repository
// file the reason names has to exist. Taken as a pure function of a map and a
// resolver so the fixtures below can prove it reports a citation that has gone
// stale -- a guard nobody has seen go red is indistinguishable from one that
// always passes, the reasoning tests/data-gate-contract.test.mjs gives for the
// same shape.
//
// Scope is `.mjs` files under tests/ and scripts/, which is what an exemption
// has so far had reason to name. Prose, a workflow, or a Markdown document
// cited in a reason is left alone: those are argued elsewhere, and widening
// the pattern to every token that looks like a path would make the guard
// report the repository's own sentences.
const CITED_PATH = /\b(?:tests|scripts)\/[A-Za-z0-9._/-]*\.mjs\b/g;

/**
 * Every repository file path named in an exemption map's reasons.
 *
 * @param {Map<string, string>} exemptions gate or collector -> reason
 * @returns {Array<{name: string, path: string}>} repo-relative citations
 */
function citedPaths(exemptions) {
  const cited = [];
  for (const [name, reason] of exemptions) {
    // A reason that is not text is already reported by the 'carries a reason'
    // guards above; there is nothing here to read.
    if (typeof reason !== 'string') continue;
    for (const [path] of reason.matchAll(CITED_PATH))
      cited.push({ name, path });
  }
  return cited;
}

/**
 * The citations that no longer resolve, as `<name>: <path>`.
 *
 * @param {Map<string, string>} exemptions gate or collector -> reason
 * @param {(path: string) => boolean} resolves repo-relative path predicate
 * @returns {string[]} sorted report, empty when every citation exists
 */
function staleCitations(exemptions, resolves) {
  return citedPaths(exemptions)
    .filter(({ path }) => !resolves(path))
    .map(({ name, path }) => `${name}: ${path}`)
    .sort();
}

const resolvesInRepo = (path) => existsSync(join(repoRoot, path));

test('every file a recorded exemption cites still exists', () => {
  const recorded = new Map([
    ...GATES_NOT_RUN_BY_CI,
    ...REFRESH_SCRIPTS_NOT_RUN_BY_CI,
  ]);
  assert.deepEqual(
    staleCitations(recorded, resolvesInRepo),
    [],
    'exemption reasons naming files the repository no longer has; the ' +
      'omission each one argues for is no longer the decision that was ' +
      'recorded, so either restore the file it rests on or re-argue the entry',
  );
});

test('both exemption maps are seen to cite the files they rest on', () => {
  // Pins the guard above to evidence rather than to spelling, the way 'every
  // gate this suite recognises is a real package.json script' does: a pattern
  // that stopped matching would make the assertion pass vacuously over an
  // empty citation list.
  for (const [label, exemptions] of [
    ['GATES_NOT_RUN_BY_CI', GATES_NOT_RUN_BY_CI],
    ['REFRESH_SCRIPTS_NOT_RUN_BY_CI', REFRESH_SCRIPTS_NOT_RUN_BY_CI],
  ]) {
    assert.ok(
      citedPaths(exemptions).length > 0,
      `expected ${label} to cite the files its reasons rest on; if an entry ` +
        'stopped naming one, the guard above has lost the evidence that it ' +
        'can see a citation at all',
    );
  }
});

test('the citation guard reports a reason whose file is gone', () => {
  const fixture = new Map([
    [
      'validate:gone',
      'Covered by tests/removed-contract.test.mjs under npm run test:unit.',
    ],
    [
      'collect:gone',
      'scripts/collect-removed.mjs documents the manual refresh.',
    ],
    [
      'validate:kept',
      'Covered by tests/workflow-scripts.test.mjs, which is this file.',
    ],
    ['check:prose', 'Argued in CONTRIBUTING.md; no repository file is named.'],
    ['check:unexplained', undefined],
  ]);
  assert.deepEqual(staleCitations(fixture, resolvesInRepo), [
    'collect:gone: scripts/collect-removed.mjs',
    'validate:gone: tests/removed-contract.test.mjs',
  ]);
});

test('a reason that names no repository file cites nothing', () => {
  assert.deepEqual(
    citedPaths(new Map([['check:prose', 'Argued in prose only.']])),
    [],
  );
});
