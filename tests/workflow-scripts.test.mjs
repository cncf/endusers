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

test('every `node scripts/...` target in package.json exists on disk', () => {
  const missing = [];
  for (const [name, body] of Object.entries(scripts)) {
    for (const match of body.matchAll(/\bnode\s+(scripts\/[\w./-]+)/g)) {
      if (!existsSync(join(repoRoot, match[1]))) {
        missing.push(`${name} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'package.json scripts point at missing files');
});

test('every config file passed to a linter in package.json exists', () => {
  // A missing dotfile here makes `npm run check` fail on a fresh clone while
  // every unit test still passes, because no test runs the linters.
  const missing = [];
  for (const [name, body] of Object.entries(scripts)) {
    for (const match of body.matchAll(
      /(?:^|\s)(?:-c|--config)\s+(\.[\w.-]+)/g,
    )) {
      if (!existsSync(join(repoRoot, match[1]))) {
        missing.push(`${name} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'linter config files referenced but absent');
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
