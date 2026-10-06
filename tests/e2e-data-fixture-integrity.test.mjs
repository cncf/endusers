// Every committed data overlay, found by reading the directories rather than
// by naming the files.
//
// tests/e2e-data-fixtures.test.mjs pins the machinery in
// tests/tools/e2e-data-fixtures.cjs against overlay documents it builds
// inline, and checks a hand-written list of the committed ones. A list is
// exactly what cannot notice the file nobody added it to: an overlay that
// applies cleanly but patches nothing has no symptom at all. The build
// succeeds, the coverage build compiles a document identical to the real data,
// and the branch the overlay exists to reach is simply never taken again —
// which looks the same from CI as a branch that was never covered.
//
// The cases below are therefore derived from the contents of
// tests/e2e/fixtures/data/ and tests/e2e/fixtures/data-variants/, so a newly
// committed overlay is held to them without anyone remembering to register it.
//
// This is deliberately not an assertion about *which* branch an overlay
// reaches — that belongs with the spec that drives it. It is the weaker
// property the directory alone can establish: the overlay names a real data
// file, still applies to it, and still changes it.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import test from 'node:test';

import {
  DATA_DIR,
  FIXTURE_DIR,
  VARIANT_FIXTURE_DIR,
  applyOverlay,
} from './tools/e2e-data-fixtures.cjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** Every committed overlay in one fixture directory, as absolute paths. */
function overlaysIn(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(dir, name));
}

const FIXTURE_OVERLAYS = overlaysIn(FIXTURE_DIR);
const VARIANT_OVERLAYS = overlaysIn(VARIANT_FIXTURE_DIR);
const ALL_OVERLAYS = [...FIXTURE_OVERLAYS, ...VARIANT_OVERLAYS];

const label = (overlayPath) => relative(REPO_ROOT, overlayPath);

// A directory that has gone empty would make every test below vacuous: each
// one iterates the list, so zero overlays means zero assertions and a green
// run that proves nothing.
test('both fixture directories hold at least one committed overlay', () => {
  assert.ok(
    FIXTURE_OVERLAYS.length > 0,
    `${label(FIXTURE_DIR)} holds no overlay; the tests below would assert nothing`,
  );
  assert.ok(
    VARIANT_OVERLAYS.length > 0,
    `${label(VARIANT_FIXTURE_DIR)} holds no overlay; the tests below would assert nothing`,
  );
});

// overlayPathFor maps data/<name> to <dir>/<name>, so an overlay whose name
// matches no data file is never read by anything: it is dead weight that
// looks like coverage.
test('every committed overlay names a data file that exists', () => {
  for (const overlayPath of ALL_OVERLAYS) {
    const dataPath = join(DATA_DIR, basename(overlayPath));
    assert.doesNotThrow(
      () => readFileSync(dataPath, 'utf8'),
      `${label(overlayPath)}: no data file at ${label(dataPath)}`,
    );
  }
});

// The same guard the build runs, run where the message is readable. A
// regenerated data file that dropped a path an overlay names fails the
// coverage build with a stack from inside a webpack loader; failing here
// names the overlay and the path instead.
test('every committed overlay still applies to its data file', () => {
  for (const overlayPath of ALL_OVERLAYS) {
    const data = JSON.parse(
      readFileSync(join(DATA_DIR, basename(overlayPath)), 'utf8'),
    );
    const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
    assert.doesNotThrow(
      () => applyOverlay(data, overlay, label(overlayPath)),
      `${label(overlayPath)}: no longer applies to its data file`,
    );
  }
});

// The property a hand-written list cannot keep: an overlay that sets a field
// to the value the data already carries, or appends to an array a collector
// has since started producing itself, applies without error and changes
// nothing. The branch it was committed to reach goes back to being
// unreachable with no failure anywhere.
test('every committed overlay still changes the document it patches', () => {
  for (const overlayPath of ALL_OVERLAYS) {
    const data = JSON.parse(
      readFileSync(join(DATA_DIR, basename(overlayPath)), 'utf8'),
    );
    const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
    const patched = applyOverlay(data, overlay, label(overlayPath));
    assert.notDeepEqual(
      patched,
      data,
      `${label(overlayPath)}: applies cleanly but patches nothing, so the branch it exists to reach is no longer reached`,
    );
  }
});

// The description is the only record of which branch an overlay exists to
// reach, and applyOverlay already rejects an empty one. What it cannot
// require is that the description says anything: every committed overlay
// names the source file whose arm it covers, which is what makes a stale
// overlay traceable to the component that stopped needing it.
test('every committed overlay describes the source it covers', () => {
  for (const overlayPath of ALL_OVERLAYS) {
    const { description } = JSON.parse(readFileSync(overlayPath, 'utf8'));
    assert.match(
      description,
      /(?:src|scripts)\/\S+\.(?:js|mjs|cjs)/,
      `${label(overlayPath)}: the description names no source file, so a reader cannot tell which arm it covers`,
    );
  }
});
