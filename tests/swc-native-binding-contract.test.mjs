// Guards the dependency shape that keeps @swc/core's native binding loadable
// on the self-hosted runner fleet.
//
// tests/tools/jsx-hooks.mjs transpiles every src/ React module through
// @swc/core, so that transpiler is load-bearing for the whole unit suite:
// when its native binding does not load, ~65 JSX-importing tests fail at once
// and the "Validate repository" job dies before asserting anything about this
// repository. The same binding is what builds the site, so the failure reaches
// `deploy-gh-pages.yml` too.
//
// That is not hypothetical. Incident #1426 is exactly this failure, and it has
// taken down main's deploy (run 38420644367) as well as all four ci.yml jobs on
// a pull request (run 38543770184), both with:
//
//   Error: Failed to load native binding
//     Error: Cannot find module './swc.linux-x64-gnu.node'
//     Error: SWC native addon: validate cache root /home/runner/.cache: cache
//            root has a parent writable by another user without trusted sticky
//            protection.
//
// Two defects cooperate there. The runner image's ~/.cache permissions defeat
// swc's fallback materialization, which is the fleet owner's half and cannot be
// fixed from this repository. The half that can is npm/cli#4828: @swc/core
// declares every platform binding as an *optional* dependency, and `npm ci`
// against a partially-populated shared ~/.npm cache silently skips an optional
// package. @swc/core then installs with no ./swc.linux-x64-gnu.node beside it,
// falls through to the cache-root path, and throws.
//
// #1428 closed that half by declaring @swc/core-linux-x64-gnu as a regular
// devDependency: a *required* dependency is not skippable under npm/cli#4828
// and is integrity-checked, so a bad install fails loudly at `npm ci` instead
// of quietly at test time. Nothing in the suite records that this is load-
// bearing. The pin reads like a redundant restatement of an optionalDependency
// @swc/core already declares, which is precisely how it gets tidied away, and
// every check in the repository stays green until a run happens to land on the
// fleet.
//
// The lockstep requirement is the sharper edge. @swc/core refuses a binding
// built for a different version, so the two specifiers have to move together.
// Dependabot's `dev-dependencies` group happens to move both today (#1451
// carried 1.16.13 -> 1.16.18 for each), but grouping is a cadence convenience,
// not a guarantee: an ungrouped security bump of @swc/core, or a local
// `npm run update:pkgs`, moves one and leaves the other. The result is a
// version-mismatch at load, which looks nothing like a dependency edit.
//
// So this file pins the three properties that edit would break, over
// package.json and package-lock.json rather than over a registry: the pin
// exists, it is exact and equal to @swc/core's, and the lockfile has not
// re-marked it `optional`. Raising the versions in lockstep keeps this green;
// skewing them, loosening either to a range, or dropping the pin fails.
//
// The checks take the two manifests as arguments so the fixtures at the bottom
// can prove each one actually reports the case it exists for. A guard nobody
// has seen go red is indistinguishable from one that always passes -- the
// reasoning tests/ci-playwright-trace-evidence.test.mjs and
// tests/data-gate-contract.test.mjs give for the same shape.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const TRANSPILER = '@swc/core';

// The binding for the platform every workflow in .github/workflows runs on:
// each job declares `runs-on: ubuntu-24.04`, which is linux/x64/glibc. Other
// platforms stay optional on purpose -- a contributor on macOS or arm64 must
// not be forced to install a linux binary, and npm skips an os/cpu mismatch
// rather than failing when the package is reachable optionally.
const BINDING = '@swc/core-linux-x64-gnu';

// An exact version, not a range: `^1.16.13` lets npm resolve the binding to a
// different patch than the transpiler it has to match.
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const lockfile = JSON.parse(
  readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'),
);

/**
 * Why the declared binding pin is unsound, or null when it is sound.
 *
 * Covers the three ways the declaration can stop protecting the install:
 * the pin is absent, either specifier is a range rather than an exact
 * version, or the two versions have drifted apart.
 *
 * @param {object} pkg - parsed package.json
 * @returns {string|null}
 */
function bindingPinViolation(pkg) {
  const dev = pkg.devDependencies ?? {};
  const transpiler = dev[TRANSPILER];
  if (typeof transpiler !== 'string') {
    return `${TRANSPILER} is not a devDependency`;
  }
  const binding = dev[BINDING];
  if (typeof binding !== 'string') {
    return (
      `${BINDING} is not a devDependency; @swc/core declares it only as an ` +
      'optional dependency, which npm ci can skip (npm/cli#4828, #1426)'
    );
  }
  for (const [name, spec] of [
    [TRANSPILER, transpiler],
    [BINDING, binding],
  ]) {
    if (!EXACT_VERSION.test(spec)) {
      return `${name} is "${spec}", which is not an exact version`;
    }
  }
  if (transpiler !== binding) {
    return (
      `${BINDING} is ${binding} but ${TRANSPILER} is ${transpiler}; ` +
      'swc refuses a binding built for a different version'
    );
  }
  return null;
}

/**
 * Why the lockfile entry for the binding is unsound, or null when it is sound.
 *
 * `optional: true` is the marker npm/cli#4828 acts on, and it is what the
 * declaration in package.json exists to clear. npm writes `devOptional` for a
 * package reachable both as a dev dependency and as someone's optional one,
 * which is the expected state here and is not the skippable marker.
 *
 * @param {object} lock - parsed package-lock.json
 * @param {string} version - the version package.json pins
 * @returns {string|null}
 */
function lockEntryViolation(lock, version) {
  const path = `node_modules/${BINDING}`;
  const entry = lock.packages?.[path];
  if (!entry) return `${path} is absent from the lockfile`;
  if (entry.optional === true) {
    return `${path} is marked optional, so npm ci may skip it (#1426)`;
  }
  if (entry.version !== version) {
    return `${path} is ${entry.version} but package.json pins ${version}`;
  }
  const root = lock.packages?.['']?.devDependencies ?? {};
  if (root[BINDING] !== version) {
    return (
      `the lockfile's root devDependencies record ${BINDING} as ` +
      `${root[BINDING]} rather than ${version}; the lockfile is out of date`
    );
  }
  return null;
}

test(`${BINDING} is pinned to ${TRANSPILER}'s exact version`, () => {
  assert.equal(bindingPinViolation(manifest), null);
});

test(`the lockfile does not let npm ci skip ${BINDING}`, () => {
  assert.equal(
    lockEntryViolation(lockfile, manifest.devDependencies[TRANSPILER]),
    null,
  );
});

// The fixtures below are the proof that the two checks above fail on the edits
// they exist to catch, rather than passing unconditionally.

test('a dropped binding pin is reported', () => {
  const { [BINDING]: _dropped, ...rest } = manifest.devDependencies;
  const violation = bindingPinViolation({ devDependencies: rest });
  assert.match(violation, /is not a devDependency/);
});

test('a manifest declaring no devDependencies at all is reported', () => {
  assert.match(bindingPinViolation({}), /@swc\/core is not a devDependency/);
});

test('a binding pin skewed from the transpiler is reported', () => {
  const violation = bindingPinViolation({
    devDependencies: {
      ...manifest.devDependencies,
      [TRANSPILER]: '1.16.18',
      [BINDING]: '1.16.13',
    },
  });
  assert.match(violation, /swc refuses a binding built for a different/);
});

test('a range in place of an exact pin is reported', () => {
  const violation = bindingPinViolation({
    devDependencies: { ...manifest.devDependencies, [BINDING]: '^1.16.13' },
  });
  assert.match(violation, /not an exact version/);
});

test('a missing transpiler is reported before the binding is inspected', () => {
  const { [TRANSPILER]: _dropped, ...rest } = manifest.devDependencies;
  const violation = bindingPinViolation({ devDependencies: rest });
  assert.match(violation, /@swc\/core is not a devDependency/);
});

test('a lockfile entry re-marked optional is reported', () => {
  const path = `node_modules/${BINDING}`;
  const version = manifest.devDependencies[TRANSPILER];
  const violation = lockEntryViolation(
    {
      packages: {
        ...lockfile.packages,
        [path]: { ...lockfile.packages[path], optional: true },
      },
    },
    version,
  );
  assert.match(violation, /marked optional/);
});

test('a lockfile entry at the wrong version is reported', () => {
  const path = `node_modules/${BINDING}`;
  const violation = lockEntryViolation(
    {
      packages: {
        ...lockfile.packages,
        [path]: { ...lockfile.packages[path], version: '0.0.0' },
      },
    },
    manifest.devDependencies[TRANSPILER],
  );
  assert.match(violation, /but package\.json pins/);
});

test('a lockfile missing the binding entirely is reported', () => {
  const path = `node_modules/${BINDING}`;
  const { [path]: _dropped, ...packages } = lockfile.packages;
  const violation = lockEntryViolation(
    { packages },
    manifest.devDependencies[TRANSPILER],
  );
  assert.match(violation, /absent from the lockfile/);
});

test('a lockfile with no root devDependencies block is reported', () => {
  const path = `node_modules/${BINDING}`;
  const version = manifest.devDependencies[TRANSPILER];
  const violation = lockEntryViolation(
    { packages: { [path]: { ...lockfile.packages[path] } } },
    version,
  );
  assert.match(violation, /the lockfile is out of date/);
});

test('a stale root devDependencies record is reported', () => {
  const version = manifest.devDependencies[TRANSPILER];
  const violation = lockEntryViolation(
    {
      packages: {
        ...lockfile.packages,
        '': {
          ...lockfile.packages[''],
          devDependencies: {
            ...lockfile.packages[''].devDependencies,
            [BINDING]: '0.0.0',
          },
        },
      },
    },
    version,
  );
  assert.match(violation, /the lockfile is out of date/);
});
