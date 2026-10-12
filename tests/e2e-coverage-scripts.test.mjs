// tests/tools/e2e-coverage-scripts.mjs seals a coverage run by copying every
// build script the run referenced into the run directory, so the published
// artifact renders without the build that produced it (#1040). No test file
// imported the module before this one: its 94.67% region coverage came from
// whatever the e2e-coverage-run tests happened to execute on the way past, and
// four regions were never reached at all.
//
// Those four are the ones worth pinning, because two of them are containment
// guards. `captureScript` reads the `sourceMappingURL` comment out of a build
// script and copies the map it names, and that comment is content, not a path
// the harness chose. A map reference that climbs out of the build root, or one
// that names a symlink pointing out of it, must leave the script uncopied
// rather than write an arbitrary file into the artifact. Both guards return
// `null`, which puts the script in `missing` and lets the reporter fall back
// to `build/` -- a silently widened copy would instead publish whatever the
// reference addressed. The two cases below are built so that removing either
// guard alone fails a test: the lexical one is proved by a reference that
// escapes and is only steered back inside by a symlink, the resolved one by a
// reference that is contained until realpath() follows it out.
//
// The other two are payload filters in `captureRunScripts`: a JSON file in the
// run directory that is not a coverage payload must be skipped by `kind`
// rather than parsed for scripts, and a payload carrying no `result` must fall
// back to an empty list instead of throwing and failing the seal.
//
// Every case here drives the exported `captureRunScripts`, not the private
// helpers, so the guards are asserted where they actually sit in the seal.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COVERAGE_SCRIPTS_DIR,
  captureRunScripts,
  scriptPathname,
  totalDecodeURIComponent,
} from './tools/e2e-coverage-scripts.mjs';

const ARTIFACT_KIND = 'endusers.playwright.v8-coverage';
const ORIGIN = 'http://127.0.0.1:3000';

function scriptUrl(name) {
  return `${ORIGIN}/assets/js/${name}`;
}

// A build script plus the run directory that references it. `mapReference` is
// written verbatim into the sourceMappingURL comment so a test can address a
// map the way a hostile build would.
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'endusers-seal-')));
  const buildDir = join(root, 'build');
  const runDir = join(root, 'run');
  await mkdir(join(buildDir, 'assets', 'js'), { recursive: true });
  await mkdir(runDir, { recursive: true });
  return { root, buildDir, runDir };
}

async function writeScript(buildDir, name, mapReference) {
  const body =
    mapReference === undefined
      ? 'console.log(1);\n'
      : `console.log(1);\n//# sourceMappingURL=${mapReference}\n`;
  await writeFile(join(buildDir, 'assets', 'js', name), body);
}

async function writePayload(runDir, name, payload) {
  await writeFile(join(runDir, name), JSON.stringify(payload));
}

function coveragePayload(names) {
  return {
    kind: ARTIFACT_KIND,
    result: names.map((name) => ({ url: scriptUrl(name) })),
  };
}

async function seal({ buildDir, runDir }) {
  return captureRunScripts(runDir, {
    buildDir,
    artifactKind: ARTIFACT_KIND,
  });
}

test('a source map reference that climbs out of the build root is refused on its face', async (t) => {
  const { root, buildDir, runDir } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  // `../../../escaped.map` leaves build/assets/js by three levels and lands in
  // the workspace root, one above the build directory -- but `escaped.map` is
  // a symlink back to a real map inside the build root, so realpath() resolves
  // it to a contained path and the later guard waves it through. Only the
  // check applied to the unresolved reference refuses it. Written this way the
  // case distinguishes the two guards: with the lexical one removed the map is
  // copied, and the test fails.
  await writeFile(join(buildDir, 'assets', 'js', 'real.map'), '{}');
  await symlink(
    join(buildDir, 'assets', 'js', 'real.map'),
    join(root, 'escaped.map'),
  );
  await writeScript(buildDir, 'escape.js', '../../../escaped.map');
  await writePayload(runDir, 'a.json', coveragePayload(['escape.js']));

  const result = await seal({ buildDir, runDir });

  assert.deepEqual(result, {
    copied: [],
    missing: ['assets/js/escape.js'],
  });
  await assert.rejects(readdir(join(runDir, COVERAGE_SCRIPTS_DIR)), {
    code: 'ENOENT',
  });
});

test('a source map that is a symlink out of the build root is not copied', async (t) => {
  const { root, buildDir, runDir } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  // The reference sits inside the build root and only leaves it once
  // realpath() follows the link, so this reaches the guard the lexical check
  // cannot: the one applied to the resolved path.
  await writeFile(join(root, 'outside.map'), '{}');
  await symlink(
    join(root, 'outside.map'),
    join(buildDir, 'assets', 'js', 'linked.js.map'),
  );
  await writeScript(buildDir, 'linked.js', 'linked.js.map');
  await writePayload(runDir, 'a.json', coveragePayload(['linked.js']));

  const result = await seal({ buildDir, runDir });

  assert.deepEqual(result, {
    copied: [],
    missing: ['assets/js/linked.js'],
  });
});

test('a run directory JSON that is not a coverage payload is skipped by kind', async (t) => {
  const { root, buildDir, runDir } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeScript(buildDir, 'wanted.js');
  await writeScript(buildDir, 'unwanted.js');
  await writePayload(runDir, 'coverage.json', coveragePayload(['wanted.js']));
  // Well-formed JSON naming a script that really is in build/: only the `kind`
  // filter keeps it out, so a copy of unwanted.js proves the filter is gone.
  await writePayload(runDir, 'error.json', {
    kind: 'endusers.playwright.v8-coverage-error',
    result: [{ url: scriptUrl('unwanted.js') }],
  });

  const result = await seal({ buildDir, runDir });

  assert.deepEqual(result, {
    copied: ['assets/js/wanted.js'],
    missing: [],
  });
});

test('a coverage payload carrying no result list seals without throwing', async (t) => {
  const { root, buildDir, runDir } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeScript(buildDir, 'wanted.js');
  await writePayload(runDir, 'empty.json', { kind: ARTIFACT_KIND });
  await writePayload(runDir, 'coverage.json', coveragePayload(['wanted.js']));

  const result = await seal({ buildDir, runDir });

  assert.deepEqual(result, {
    copied: ['assets/js/wanted.js'],
    missing: [],
  });
});

// A literal `%` not followed by two hex digits is a valid URL pathname
// character that decodeURIComponent rejects. The seal step must capture such
// a script, not crash on it: before #1150 one executed asset named 100%.js
// failed the whole End-to-end coverage job.
test('a script whose name defeats percent-decoding is still captured', async (t) => {
  const { root, buildDir, runDir } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeScript(buildDir, '100%.js');
  await writePayload(runDir, 'coverage.json', coveragePayload(['100%.js']));

  const result = await seal({ buildDir, runDir });

  assert.deepEqual(result, { copied: ['assets/js/100%.js'], missing: [] });
  assert.deepEqual(
    await readdir(join(runDir, COVERAGE_SCRIPTS_DIR, 'assets', 'js')),
    ['100%.js'],
  );
});

test('scriptPathname decodes an encoded name and passes a malformed one through', () => {
  assert.equal(
    scriptPathname(`${ORIGIN}/assets/js/na%20me.js`),
    'assets/js/na me.js',
  );
  assert.equal(
    scriptPathname(`${ORIGIN}/assets/js/100%.js`),
    'assets/js/100%.js',
  );
  assert.equal(totalDecodeURIComponent('%7E'), '~');
  assert.equal(totalDecodeURIComponent('100%'), '100%');
});

test('a script and the map it names are copied together into the run directory', async (t) => {
  const { root, buildDir, runDir } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(buildDir, 'assets', 'js', 'mapped.js.map'), '{}');
  await writeScript(buildDir, 'mapped.js', 'mapped.js.map');
  await writePayload(runDir, 'coverage.json', coveragePayload(['mapped.js']));

  const result = await seal({ buildDir, runDir });

  assert.deepEqual(result, {
    copied: ['assets/js/mapped.js', 'assets/js/mapped.js.map'],
    missing: [],
  });
  assert.deepEqual(
    await readdir(join(runDir, COVERAGE_SCRIPTS_DIR, 'assets', 'js')),
    ['mapped.js', 'mapped.js.map'],
  );
});
