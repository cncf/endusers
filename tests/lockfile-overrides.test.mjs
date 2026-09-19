import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const lock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const NM = 'node_modules/';

// Every entry in package-lock.json "packages" keyed by an install path,
// as [installPath, name, version]. The root entry ("") is excluded.
const installed = Object.entries(lock.packages)
  .filter(([path, meta]) => path.includes(NM) && meta.version)
  .map(([path, meta]) => [
    path,
    path.slice(path.lastIndexOf(NM) + NM.length),
    meta.version,
  ]);

// The overrides in this repo are all minimum-version floors: each one exists
// to keep a transitive dependency at or above a version that fixes a known
// advisory. Parse the floor rather than implementing range semantics, and
// refuse anything this test cannot reason about so an unsupported range can
// never pass silently.
function floorOf(range) {
  const match = /^[\^~>=]*\s*(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  assert.ok(
    match,
    `override range "${range}" is not a form this test understands; ` +
      'extend floorOf() before introducing it',
  );
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Numeric compare of the release triple. Prerelease tags are not used by any
// override target here; a prerelease version fails the assert in floorOf's
// counterpart below rather than being silently ordered.
function atOrAbove(version, floor) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  assert.ok(match, `unparseable locked version "${version}"`);
  const actual = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] !== floor[i]) return actual[i] > floor[i];
  }
  return true;
}

// "picomatch" selects every instance; "ajv@8" selects only the 8.x instances.
function parseSelector(selector) {
  const at = selector.lastIndexOf('@');
  if (at <= 0) return { name: selector, major: null };
  return { name: selector.slice(0, at), major: selector.slice(at + 1) };
}

function selects({ name, major }, pkgName, version) {
  if (pkgName !== name) return false;
  return major === null || String(version).split('.')[0] === major;
}

// Node resolves a dependency of <parentPath> by looking in that package's own
// node_modules first, then walking up to each enclosing node_modules. npm
// hoists whenever it can, so a nested override frequently lands at the root.
function resolveFrom(parentPath, childName) {
  const segments = `${parentPath}/${NM}${childName}`.split('/');
  for (let i = segments.length; i > 0; i -= 1) {
    const candidate = segments
      .slice(0, i - 1)
      .concat(NM.slice(0, -1), childName)
      .join('/')
      .replace(/\/+/g, '/');
    const hit = installed.find(([path]) => path === candidate);
    if (hit) return hit;
  }
  return null;
}

const overrides = pkg.overrides ?? {};

test('package-lock.json belongs to this package', () => {
  assert.ok(
    lock.lockfileVersion >= 3,
    `lockfileVersion ${lock.lockfileVersion} predates the "packages" map this test reads`,
  );
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.ok(installed.length > 0, 'lockfile lists no installed packages');
});

test('package.json declares overrides for this test to check', () => {
  // Without this the assertions below would pass vacuously if the overrides
  // block were dropped or renamed.
  assert.ok(
    Object.keys(overrides).length > 0,
    'expected a non-empty overrides block in package.json',
  );
});

test('every override selector matches a package in the lockfile', () => {
  for (const [selector, value] of Object.entries(overrides)) {
    const parsed = parseSelector(selector);
    const matches = installed.filter(([, name, version]) =>
      selects(parsed, name, version),
    );
    assert.ok(
      matches.length > 0,
      `override "${selector}" matches nothing in package-lock.json; ` +
        'it is a typo or is pinning a dependency that is no longer installed',
    );
    if (typeof value !== 'string') {
      for (const child of Object.keys(value)) {
        const resolved = matches
          .map(([path]) => resolveFrom(path, child))
          .filter(Boolean);
        assert.ok(
          resolved.length > 0,
          `nested override "${selector} > ${child}" resolves to nothing; ` +
            `no instance of ${selector} can reach a package named ${child}`,
        );
      }
    }
  }
});

test('no installed version sits below its override floor', () => {
  for (const [selector, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') continue;
    const parsed = parseSelector(selector);
    const floor = floorOf(value);
    for (const [path, name, version] of installed) {
      if (!selects(parsed, name, version)) continue;
      assert.ok(
        atOrAbove(version, floor),
        `${path} is ${version}, below the "${selector}": "${value}" override ` +
          'floor — package-lock.json was not regenerated after the override changed',
      );
    }
  }
});

test('every nested override is enforced where its parent resolves it', () => {
  for (const [selector, value] of Object.entries(overrides)) {
    if (typeof value === 'string') continue;
    const parsed = parseSelector(selector);
    const parents = installed.filter(([, name, version]) =>
      selects(parsed, name, version),
    );
    for (const [child, range] of Object.entries(value)) {
      const floor = floorOf(range);
      for (const [parentPath] of parents) {
        const resolved = resolveFrom(parentPath, child);
        if (!resolved) continue;
        const [childPath, , childVersion] = resolved;
        assert.ok(
          atOrAbove(childVersion, floor),
          `${parentPath} resolves ${child} to ${childPath} at ${childVersion}, ` +
            `below the "${selector}" > "${child}": "${range}" override floor`,
        );
      }
    }
  }
});
