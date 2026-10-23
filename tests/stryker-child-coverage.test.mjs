import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  mergeStrykerChildCoverage,
  runScriptWithFixtures,
} from './helpers.mjs';

// Mutation testing only schedules a mutant it has seen run. The validator
// scripts run in a child process that runScriptWithFixtures spawns, so before
// this bridge existed every mutant in a top-level scripts/*.mjs file reported
// "no coverage" and was never tested, however many assertions the suite made
// about the script. Nothing else exercises the bridge, and a silent regression
// in it would not fail a test — it would quietly return those files to
// scoring as untested.

const NAMESPACE = process.env.STRYKER_NAMESPACE || '__stryker__';
const HOOK = fileURLToPath(
  new URL('./tools/stryker-child-coverage.cjs', import.meta.url),
);

// The test process may itself be running under Stryker, where the namespace
// holds the real run's counters. Swap in a scratch object for the duration
// and put the original back.
function withNamespace(value, body) {
  const had = Object.hasOwn(globalThis, NAMESPACE);
  const original = globalThis[NAMESPACE];
  if (value === undefined) delete globalThis[NAMESPACE];
  else globalThis[NAMESPACE] = value;
  try {
    return body();
  } finally {
    if (had) globalThis[NAMESPACE] = original;
    else delete globalThis[NAMESPACE];
  }
}

test('mergeStrykerChildCoverage does nothing outside a mutation run', () => {
  withNamespace(undefined, () => {
    mergeStrykerChildCoverage({ mutantCoverage: { static: { 1: 1 } } });
    assert.equal(globalThis[NAMESPACE], undefined);
  });
});

test('mergeStrykerChildCoverage ignores a child that reported nothing', () => {
  const ns = {};
  withNamespace(ns, () => {
    mergeStrykerChildCoverage(null);
    mergeStrykerChildCoverage({ mutantCoverage: null, hitCount: null });
  });
  assert.deepEqual(ns, {});
});

test('mergeStrykerChildCoverage seeds the coverage buckets', () => {
  const ns = {};
  withNamespace(ns, () => {
    mergeStrykerChildCoverage({
      mutantCoverage: { static: { 7: 2 }, perTest: { a: { 7: 1 } } },
    });
  });
  assert.deepEqual(ns.mutantCoverage, {
    static: { 7: 2 },
    perTest: { a: { 7: 1 } },
  });
});

test('mergeStrykerChildCoverage tolerates a half-populated report', () => {
  // A child that never reached an instrumented branch has one bucket and not
  // the other; reading the absent one must not throw inside the harness every
  // other suite spawns its scripts through.
  const staticOnly = {};
  withNamespace(staticOnly, () => {
    mergeStrykerChildCoverage({ mutantCoverage: { static: { 7: 2 } } });
  });
  assert.deepEqual(staticOnly.mutantCoverage, {
    static: { 7: 2 },
    perTest: {},
  });

  const perTestOnly = {};
  withNamespace(perTestOnly, () => {
    mergeStrykerChildCoverage({ mutantCoverage: { perTest: { a: { 7: 1 } } } });
  });
  assert.deepEqual(perTestOnly.mutantCoverage, {
    static: {},
    perTest: { a: { 7: 1 } },
  });
});

test('mergeStrykerChildCoverage adds to counts already recorded', () => {
  // Several spawns in one test file must sum, not overwrite: a mutant Stryker
  // believes ran once when it ran five times is still scheduled, but the hit
  // limit that stops an infinite-loop mutant is armed with the wrong number.
  const ns = {
    mutantCoverage: { static: { 7: 2, 8: 1 }, perTest: { a: { 7: 1 } } },
  };
  withNamespace(ns, () => {
    mergeStrykerChildCoverage({
      mutantCoverage: {
        static: { 7: 3 },
        perTest: { a: { 7: 4, 9: 1 }, b: { 7: 1 } },
      },
    });
  });
  assert.deepEqual(ns.mutantCoverage, {
    static: { 7: 5, 8: 1 },
    perTest: { a: { 7: 5, 9: 1 }, b: { 7: 1 } },
  });
});

test('mergeStrykerChildCoverage carries the child hit count back', () => {
  const ns = { hitCount: 2 };
  withNamespace(ns, () => {
    mergeStrykerChildCoverage({ hitCount: 3 });
  });
  assert.equal(ns.hitCount, 5);
});

test('mergeStrykerChildCoverage leaves an unarmed hit count alone', () => {
  // Stryker only sets hitCount when it set a hit limit; creating one here
  // would make the instrumented guard start throwing against no limit.
  const ns = {};
  withNamespace(ns, () => {
    mergeStrykerChildCoverage({ hitCount: 3 });
  });
  assert.equal('hitCount' in ns, false);
  const unarmed = { hitCount: 1 };
  withNamespace(unarmed, () => {
    mergeStrykerChildCoverage({ hitCount: null });
  });
  assert.equal(unarmed.hitCount, 1);
});

// The hook is a `node -r` preload, so it is exercised the way the harness uses
// it: by running a child process against it.
function runHook(body, env = {}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-stryker-hook-'));
  try {
    const script = join(work, 'child.mjs');
    writeFileSync(script, body);
    const result = spawnSync('node', ['-r', HOOK, script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let dumped = null;
    try {
      dumped = JSON.parse(readFileSync(join(work, 'coverage.json'), 'utf8'));
    } catch {
      dumped = null;
    }
    return { ...result, dumped, work };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const RECORD = `globalThis.${NAMESPACE} = globalThis.${NAMESPACE} || {};
globalThis.${NAMESPACE}.mutantCoverage = { static: { 11: 1 }, perTest: {} };
`;

test('the preload dumps the child coverage to the requested file', () => {
  const work = mkdtempSync(join(tmpdir(), 'endusers-stryker-hook-out-'));
  const target = join(work, 'coverage.json');
  try {
    const script = join(work, 'child.mjs');
    writeFileSync(script, RECORD);
    const result = spawnSync('node', ['-r', HOOK, script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, STRYKER_CHILD_COVERAGE_FILE: target },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), {
      mutantCoverage: { static: { 11: 1 }, perTest: {} },
      hitCount: null,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('the preload stays inert when no dump file is requested', () => {
  // Every other suite in this repository spawns these scripts outside a
  // mutation run; the hook must not write anything then.
  const { status, dumped } = runHook(RECORD, {
    STRYKER_CHILD_COVERAGE_FILE: '',
  });
  assert.equal(status, 0);
  assert.equal(dumped, null);
});

test('the preload writes nothing for a child that recorded no namespace', () => {
  const work = mkdtempSync(join(tmpdir(), 'endusers-stryker-hook-bare-'));
  const target = join(work, 'coverage.json');
  try {
    const script = join(work, 'child.mjs');
    writeFileSync(script, 'export {};\n');
    const result = spawnSync('node', ['-r', HOOK, script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, STRYKER_CHILD_COVERAGE_FILE: target },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => readFileSync(target, 'utf8'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('the preload arms the hit limit before the child module loads', () => {
  // Without this the guard the instrumented source compiles in never fires,
  // and an infinite-loop mutant spins until Stryker times out the whole test
  // file instead of the one child.
  const work = mkdtempSync(join(tmpdir(), 'endusers-stryker-hook-limit-'));
  const target = join(work, 'coverage.json');
  try {
    const script = join(work, 'child.mjs');
    writeFileSync(
      script,
      `const ns = globalThis.${NAMESPACE};
if (ns.hitLimit !== 25) { console.error('hitLimit', ns.hitLimit); process.exit(3); }
ns.hitCount += 4;
`,
    );
    const result = spawnSync('node', ['-r', HOOK, script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        STRYKER_CHILD_COVERAGE_FILE: target,
        STRYKER_HIT_LIMIT: '25',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), {
      mutantCoverage: null,
      hitCount: 4,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('the preload survives a dump file it cannot write', () => {
  // The sandbox the harness names is removed on some paths before the child
  // exits. Losing those counters must not change the status the test asserts.
  const { status, stderr } = runHook(RECORD, {
    STRYKER_CHILD_COVERAGE_FILE: join(
      tmpdir(),
      'endusers-stryker-missing-dir',
      'nested',
      'coverage.json',
    ),
  });
  assert.equal(status, 0, stderr);
});

// runScriptWithFixtures only wires the bridge up when a mutation run is in
// progress, so these two cases are the only ones that reach that branch.
// NODE_OPTIONS stands in for the instrumented source Stryker would have
// written into the sandbox: it is the child, not the test process, that has to
// record the coverage.
function withStrykerRun(childPreload, body) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-stryker-run-'));
  const nodeOptions = process.env.NODE_OPTIONS;
  const ns = {};
  try {
    if (childPreload) {
      const preload = join(work, 'simulate-instrumentation.cjs');
      writeFileSync(preload, childPreload);
      process.env.NODE_OPTIONS = `${nodeOptions ? `${nodeOptions} ` : ''}--require ${preload}`;
    }
    return withNamespace(ns, () => body(ns));
  } finally {
    if (nodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = nodeOptions;
    rmSync(work, { recursive: true, force: true });
  }
}

test('a spawned script reports its mutant coverage back to the test process', () => {
  const ns = withStrykerRun(
    `globalThis.${NAMESPACE} = globalThis.${NAMESPACE} || {};
globalThis.${NAMESPACE}.mutantCoverage = { static: { 42: 3 }, perTest: {} };
`,
    (namespace) => {
      runScriptWithFixtures('validate-awards.mjs', {
        'data/awards.json': JSON.stringify({ awards: [] }),
      });
      return namespace;
    },
  );
  assert.deepEqual(ns.mutantCoverage, { static: { 42: 3 }, perTest: {} });
});

test('a spawned script that recorded nothing leaves the coverage untouched', () => {
  // The scripts are plain source outside the files Stryker chose to mutate,
  // so most spawns dump nothing at all.
  const ns = withStrykerRun(null, (namespace) => {
    // The script's own verdict is irrelevant here; what matters is that a
    // child which recorded nothing contributes nothing.
    runScriptWithFixtures('validate-awards.mjs', {
      'data/awards.json': JSON.stringify({ awards: [] }),
    });
    return namespace;
  });
  assert.deepEqual(ns, {});
});
