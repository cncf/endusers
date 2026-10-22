// tests/e2e/fixtures/accepted-regions.json records the zero-count regions ADR 0007
// triages out of the browser lane -- data-shape guards the unit lane already
// pins, and source-map span drift -- so the e2e coverage report stops listing
// them as findings. The reporter treats an accepted region as neither covered
// nor uncovered and prints it in its own section with its reason.
//
// A registry of exceptions rots unless the lane checks it, so these tests pin
// three things: the committed registry is well formed and names files that
// exist; the reporter excludes an accepted zero, leaves an unlisted zero
// uncovered, and lists the acceptance; and an entry the run no longer
// supports -- its span now covered, or no longer reported at all -- is flagged
// stale and fails `main()` after the artifact is written.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTED_REGIONS_PATH,
  ACCEPTED_REGION_CLASSES,
  collectE2ECoverage,
  main,
  parseAcceptedRegions,
  renderE2ECoverageReport,
} from './tools/e2e-coverage-report.mjs';
import {
  reportArgs,
  writeIdentityMappedRun,
} from './tools/e2e-coverage-identity-fixture.mjs';
import { sealCoverageRun } from './tools/e2e-coverage-run.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Two lines, every line executed, three ternary arms never taken: two of them
// share line 1 so the registry's position ordering has a same-line pair to
// sort, and the third sits on line 2.
const SOURCE = [
  "export const label = (on, big) => (on ? 'hit' : 'miss') + (big ? 'L' : 's');",
  "export const other = (x) => (x ? 'yes' : 'no');",
  '',
].join('\n');
const MISSED = ["'miss'", "'s'", "'no'"];
const FILE = 'src/components/Label/index.js';
const SPANS = {
  miss: '1:48-1:54',
  s: '1:71-1:74',
  no: '2:41-2:45',
};
// The executed text between the first two misses, which the run reports as a
// covered region.
const COVERED_SPAN = '1:54-1:71';

async function fixtureRun({ registry = null, runId = 'run-accepted' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'endusers-e2e-accepted-'));
  const fixture = await writeIdentityMappedRun(root, {
    runId,
    file: FILE,
    source: SOURCE,
    missed: MISSED,
  });
  await sealCoverageRun(fixture.runDir, 'passed');
  if (registry) {
    await mkdir(join(root, 'tests/e2e/fixtures'), { recursive: true });
    await writeFile(
      join(root, ACCEPTED_REGIONS_PATH),
      `${JSON.stringify(registry, null, 2)}\n`,
    );
  }
  return fixture;
}

function entry(span, extra = {}) {
  return {
    file: FILE,
    span,
    class: 'data-shape-guard',
    reason: `fixture arm at ${span}`,
    ...extra,
  };
}

function collect(fixture) {
  return collectE2ECoverage(fixture.runDir, {
    root: fixture.root,
    buildDir: fixture.buildDir,
  });
}

// ---------------------------------------------------------------------------
// The committed registry.
// ---------------------------------------------------------------------------

test('the committed registry is well formed and names files that still exist', async () => {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, ACCEPTED_REGIONS_PATH), 'utf8'),
  );
  const entries = parseAcceptedRegions(raw);
  assert.ok(entries.length > 0, 'the registry lists at least one region');
  for (const accepted of entries) {
    assert.ok(
      existsSync(join(REPO_ROOT, accepted.file)),
      `${ACCEPTED_REGIONS_PATH} names ${accepted.file}, which no longer exists`,
    );
    const [startLine] = accepted.span.split(':').map(Number);
    const lineCount = (await readFile(join(REPO_ROOT, accepted.file), 'utf8'))
      .split('\n')
      .filter(
        (line, index, lines) => index < lines.length - 1 || line !== '',
      ).length;
    assert.ok(
      startLine <= lineCount,
      `${accepted.file} ${accepted.span} starts past the file's ${lineCount} lines`,
    );
  }
  // Provenance for the spans, so a reader can tell which build they were
  // quoted from before re-running the lane to refresh them.
  assert.match(raw.measured?.revision ?? '', /^[0-9a-f]{40}$/u);
  assert.match(raw.measured?.node ?? '', /^v\d+\.\d+\.\d+$/u);
});

test('parseAcceptedRegions rejects every malformed shape by index', () => {
  assert.throws(
    () => parseAcceptedRegions({ entries: {} }),
    /must be an object with an "entries" array/u,
  );
  assert.throws(
    () => parseAcceptedRegions(null),
    /must be an object with an "entries" array/u,
  );
  const good = entry('1:48-1:54');
  const cases = [
    [{ ...good, file: 'docs/index.md' }, /entry 0 must name a src\/ file/u],
    [{ ...good, file: undefined }, /entry 0 must name a src\/ file/u],
    [{ ...good, span: '43-49' }, /entry 0 must give its span as/u],
    [{ ...good, span: 43 }, /entry 0 must give its span as/u],
    [
      { ...good, class: 'flaky' },
      /entry 0 must have class data-shape-guard or span-drift/u,
    ],
    [{ ...good, reason: '  ' }, /entry 0 must give a reason/u],
    [{ ...good, reason: null }, /entry 0 must give a reason/u],
  ];
  for (const [bad, message] of cases) {
    assert.throws(() => parseAcceptedRegions({ entries: [bad] }), message);
  }
  assert.throws(
    () => parseAcceptedRegions({ entries: [good, { ...good }] }),
    /entry 1 is listed twice/u,
  );
  assert.throws(
    () => parseAcceptedRegions({ entries: [null] }),
    /entry 0 must name a src\/ file \(file null, span null\)/u,
  );
  assert.deepEqual(parseAcceptedRegions({ entries: [good] }), [good]);
  assert.deepEqual(ACCEPTED_REGION_CLASSES, ['data-shape-guard', 'span-drift']);
});

// ---------------------------------------------------------------------------
// The reporter against a registry.
// ---------------------------------------------------------------------------

test('without a registry every zero is uncovered and the new sections are empty', async () => {
  const fixture = await fixtureRun();
  try {
    const report = await collect(fixture);
    const [row] = report.sources;
    assert.deepEqual(row.uncoveredRegions, [1, 1, 2]);
    assert.deepEqual(row.uncoveredRegionSpans, [SPANS.miss, SPANS.s, SPANS.no]);
    assert.equal(row.regions - row.coveredRegions, 3);
    assert.deepEqual(report.acceptedRegions, []);
    assert.deepEqual(report.staleAcceptedRegions, []);
    const text = renderE2ECoverageReport(report);
    assert.match(
      text,
      new RegExp(
        `Uncovered regions:\\n- ${FILE} ${SPANS.miss}\\n- ${FILE} ${SPANS.s}\\n- ${FILE} ${SPANS.no}\\n`,
      ),
    );
    assert.doesNotMatch(text, /Accepted regions/u);
    assert.doesNotMatch(text, /Stale accepted regions/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('an accepted zero leaves the uncovered list and both region counts; an unlisted zero stays', async () => {
  const bare = await fixtureRun();
  const fixture = await fixtureRun({
    registry: {
      entries: [
        entry(SPANS.no),
        entry(SPANS.s, { class: 'span-drift' }),
        // Listed out of position order on purpose.
        entry(SPANS.miss),
      ],
    },
  });
  try {
    const before = (await collect(bare)).sources[0];
    const report = await main(reportArgs(fixture));
    const [row] = report.sources;
    // Three accepted, so the denominator drops by three and the numerator
    // does not move: accepted regions are neither covered nor uncovered.
    assert.equal(row.regions, before.regions - 3);
    assert.equal(row.coveredRegions, before.coveredRegions);
    assert.deepEqual(row.uncoveredRegions, []);
    assert.deepEqual(row.uncoveredRegionSpans, []);
    assert.equal(row.regionPercent, 100);
    assert.equal(report.summary.regions, row.regions);
    assert.equal(report.summary.regionPercent, 100);
    assert.deepEqual(
      report.acceptedRegions.map((accepted) => accepted.span),
      [SPANS.miss, SPANS.s, SPANS.no],
    );
    assert.deepEqual(report.staleAcceptedRegions, []);

    const text = await readFile(join(fixture.root, 'report.txt'), 'utf8');
    assert.doesNotMatch(text, /Uncovered regions:/u);
    assert.match(
      text,
      new RegExp(
        `Accepted regions \\(ADR 0007, ${ACCEPTED_REGIONS_PATH}; counted as neither covered nor uncovered\\):\\n` +
          `- ${FILE} ${SPANS.miss} \\[data-shape-guard\\] fixture arm at ${SPANS.miss}\\n` +
          `- ${FILE} ${SPANS.s} \\[span-drift\\] fixture arm at ${SPANS.s}\\n` +
          `- ${FILE} ${SPANS.no} \\[data-shape-guard\\] fixture arm at ${SPANS.no}\\n`,
      ),
    );
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.equal(json.acceptedRegions.length, 3);
  } finally {
    await rm(bare.root, { recursive: true, force: true });
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('accepting one zero does not touch its neighbours', async () => {
  const fixture = await fixtureRun({
    registry: { entries: [entry(SPANS.s)] },
  });
  try {
    const report = await collect(fixture);
    const [row] = report.sources;
    assert.deepEqual(row.uncoveredRegions, [1, 2]);
    assert.deepEqual(row.uncoveredRegionSpans, [SPANS.miss, SPANS.no]);
    assert.equal(row.regions - row.coveredRegions, 2);
    assert.deepEqual(
      report.acceptedRegions.map((accepted) => accepted.span),
      [SPANS.s],
    );
    // The per-file floor reads the same counts, so an accepted region cannot
    // push a file under it.
    await assert.rejects(
      main(reportArgs(fixture, ['--check-source-file-regions', '100'])),
      /\(\d+\/\d+ regions; uncovered at 1 2\)/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('an accepted region the run now covers is stale and fails main() after writing the artifact', async () => {
  const covered = COVERED_SPAN;
  const fixture = await fixtureRun({
    registry: { entries: [entry(covered), entry(SPANS.no)] },
  });
  try {
    const report = await collect(fixture);
    assert.deepEqual(report.staleAcceptedRegions, [
      { ...entry(covered), cause: 'covered by this run (count 1)' },
    ]);
    // The stale entry is not consumed: it stays in the counts as the covered
    // region it is, and the valid entry beside it is still honoured.
    assert.deepEqual(
      report.acceptedRegions.map((accepted) => accepted.span),
      [SPANS.no],
    );
    assert.deepEqual(report.sources[0].uncoveredRegionSpans, [
      SPANS.miss,
      SPANS.s,
    ]);

    await assert.rejects(
      main(reportArgs(fixture)),
      new RegExp(
        `1 accepted region\\(s\\) in ${ACCEPTED_REGIONS_PATH} are stale; remove them:\\n` +
          `  ${FILE} ${covered}: covered by this run \\(count 1\\)`,
      ),
    );
    const text = await readFile(join(fixture.root, 'report.txt'), 'utf8');
    assert.match(
      text,
      new RegExp(
        `Stale accepted regions \\(remove from ${ACCEPTED_REGIONS_PATH}\\):\\n` +
          `- ${FILE} ${covered} \\[data-shape-guard\\] covered by this run \\(count 1\\)\\n`,
      ),
    );
    const json = JSON.parse(
      await readFile(join(fixture.root, 'report.json'), 'utf8'),
    );
    assert.equal(json.status, 'ok');
    assert.equal(json.staleAcceptedRegions.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('an accepted region the run never reports is stale, including one in a file the run never saw', async () => {
  const otherFile = 'src/components/Other/index.js';
  const fixture = await fixtureRun({
    registry: {
      entries: [
        entry('7:40-7:46', { file: otherFile }),
        entry('1:0-1:1'),
        entry(SPANS.miss),
      ],
    },
  });
  try {
    const report = await collect(fixture);
    assert.deepEqual(report.staleAcceptedRegions, [
      { ...entry('1:0-1:1'), cause: 'not a region this run reports' },
      {
        ...entry('7:40-7:46', { file: otherFile }),
        cause: 'not a region this run reports',
      },
    ]);
    assert.deepEqual(
      report.acceptedRegions.map((accepted) => accepted.span),
      [SPANS.miss],
    );
    await assert.rejects(
      main(reportArgs(fixture)),
      /2 accepted region\(s\) in .* are stale; remove them:\n {2}src\/components\/Label\/index\.js 1:0-1:1: not a region this run reports\n {2}src\/components\/Other\/index\.js 7:40-7:46: not a region this run reports/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('a malformed registry fails the report before anything is rendered', async () => {
  const fixture = await fixtureRun({
    registry: { entries: [entry('nope')] },
  });
  try {
    await assert.rejects(
      collect(fixture),
      /tests\/e2e\/fixtures\/accepted-regions\.json entry 0 must give its span as startLine:startCol-endLine:endCol/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
