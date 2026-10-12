// A source file can leave every coverage ratio in two ways, and until this
// guard existed `--require-source-files` only caught one of them.
//
// The caught one is a file nothing imports: it is recorded nowhere, so
// `missingSourceFiles` finds it on disk, names it, and fails the gate. The
// uncaught one is a file that *was* executed but whose V8 record could not be
// attributed back to the text on disk. `collect()` drops that record and puts
// the path in `unmapped`; `report()` is built from the merged map alone, so
// the file is absent from the `src files` numerator and denominator together.
// Every percentage gate then passes over it in silence, and
// `--require-source-files` passed too, because `main()` counts `unmapped` as
// measured -- correctly, for a question about files nothing ran at all.
//
// The net effect was that a whole module could stop being measured with the
// full gate still exiting 0. Simulating the drift this guard is for -- one
// JSX component whose transpiled text no longer matches what was recorded --
// left `npm run test:unit:coverage:check` green at 593b9fe while
// src/components/CaseStudies/index.js (158 lines, 35 regions) silently left
// the denominator, visible only in the informational "Not reported" notice,
// which nothing scores.
//
// That drift is not hypothetical. `tryRemapJsx` rebuilds the loader's output
// and compares its *length* against the recorded text before trusting the
// offsets, so any change to swc's output or to tests/tools/jsx-hooks.mjs --
// a dependency bump is enough -- turns a mapped component into an unmapped
// one, with the suite still green.
//
// These tests pin the new half: which recorded-but-unmappable files the gate
// claims (the `SOURCE_ROOTS` trees, so the nine data/*.json modules go on
// being listed without failing anything), and that the two file-set
// diagnoses are reported together rather than one hiding the other.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { unmappedSourceFiles } from './tools/coverage-report.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-unmapped-sources-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('unmappedSourceFiles claims only recorded files inside the walked trees', () => {
  const root = fixtureRoot({
    'src/components/Widget/index.js': '',
    'scripts/one.mjs': '',
    'tests/tools/harness.mjs': '',
    // On disk but absent from the unmapped set, so the gate leaves it alone:
    // this walk names what is claimed, it does not claim the whole tree.
    'scripts/measured.mjs': '',
  });
  try {
    assert.deepEqual(
      unmappedSourceFiles(
        [
          'src/components/Widget/index.js',
          'scripts/one.mjs',
          'tests/tools/harness.mjs',
          // Outside SOURCE_ROOTS: a JSON data module is unmapped on every run
          // by construction, and gating on it would fail the suite forever.
          'data/members.json',
          // Outside SOURCE_ROOTS: the suite, not the harness it runs on.
          'tests/widget.test.mjs',
        ],
        root,
      ),
      [
        'scripts/one.mjs',
        'src/components/Widget/index.js',
        'tests/tools/harness.mjs',
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unmappedSourceFiles claims nothing when every record mapped', () => {
  const root = fixtureRoot({ 'src/a.mjs': '', 'scripts/b.mjs': '' });
  try {
    assert.deepEqual(unmappedSourceFiles([], root), []);
    // A path that is unmapped but does not exist on disk is not invented:
    // the walk is the source of truth for what the gate can claim.
    assert.deepEqual(unmappedSourceFiles(['src/deleted.mjs'], root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unmappable source file is not also reported as never measured', () => {
  // The two diagnoses must stay disjoint: `missingSourceFiles` deliberately
  // treats an unmapped file as measured (tests/coverage-report-source-files
  // .test.mjs pins that), and this gate is what covers the case that
  // exemption opens. A file counted by both would make every JSX component a
  // permanent failure the moment it drifted, which is the outcome that
  // exemption exists to prevent.
  const root = fixtureRoot({ 'src/drifted.js': '', 'src/forgotten.mjs': '' });
  try {
    assert.deepEqual(unmappedSourceFiles(['src/drifted.js'], root), [
      'src/drifted.js',
    ]);
    assert.ok(
      !unmappedSourceFiles(['src/drifted.js'], root).includes(
        'src/forgotten.mjs',
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--require-source-files fails a real run over an unmappable module', () => {
  // End-to-end, because the gap was in main()'s wiring rather than in any
  // helper: both halves of the file-set floor existed in isolation and the
  // unmapped one was simply never consulted.
  //
  // The drift is produced the way it happens in the wild -- the text on disk
  // stops being the text that was measured -- by appending to the module
  // after the suite has imported it. collect() then compares the recorded
  // length against a longer file, finds no JSX to remap, and files the path
  // under `unmapped`.
  const id = randomUUID().slice(0, 8);
  const toolRel = join('tests', 'tools', `drift-${id}.mjs`);
  const specRel = join('tests', `drift-${id}.test.mjs`);
  const toolPath = join(REPO_ROOT, toolRel);
  const specPath = join(REPO_ROOT, specRel);
  writeFileSync(toolPath, 'export const drifted = () => true;\n');
  writeFileSync(
    specPath,
    [
      "import { appendFileSync } from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      "import test from 'node:test';",
      `import { drifted } from './tools/drift-${id}.mjs';`,
      '',
      "test('drifts after import', () => {",
      '  drifted();',
      '  appendFileSync(',
      `    fileURLToPath(new URL('./tools/drift-${id}.mjs', import.meta.url)),`,
      "    '// grown after the record was taken\\n',",
      '  );',
      '});',
      '',
    ].join('\n'),
  );
  try {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.NODE_TEST_CONTEXT;
    const gated = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./tools/coverage-report.mjs', import.meta.url)),
        '--require-source-files',
        '--',
        specRel,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', env },
    );
    assert.equal(gated.status, 1, gated.stderr);
    assert.match(gated.stderr, /could not be mapped onto the text on disk/);
    assert.match(gated.stderr, new RegExp(`drift-${id}\\.mjs`));
    // The narrow run also leaves almost every source file unimported, so the
    // older diagnosis fires too. Both must appear: before this guard the
    // first one exited and the second was never reached.
    assert.match(gated.stderr, /source file\(s\) were never measured/);
    // The file is unmapped, not missing, so it must not be named by the
    // "Never measured" notice.
    const missingNotice = gated.stdout.match(
      /\nNever measured \(\d+\):([\s\S]*?)(?=\nNot reported \(|$)/,
    );
    assert.ok(missingNotice, `no "Never measured" notice in:\n${gated.stdout}`);
    assert.ok(
      !missingNotice[1].includes(`drift-${id}.mjs`),
      `an unmapped file was reported as never measured:\n${missingNotice[1]}`,
    );
  } finally {
    rmSync(toolPath, { force: true });
    rmSync(specPath, { force: true });
  }
});
