// Guards that every committed dataset under data/ is read by something CI runs.
//
// The repository gates its data two ways, and both execute in the "Validate
// repository" job: a `scripts/validate-*.mjs` wired to a `validate:*` script
// (tests/workflow-scripts.test.mjs proves each one is run by a workflow), or a
// contract test under tests/ that parses the committed file and asserts its
// shape. Either kind counts here: a rule that demanded a validator would be
// stricter than the repository has ever needed to be.
//
// What nothing checks today is the case neither kind covers: a dataset that
// lands with *no* reader at all. That is not hypothetical. Until it gained
// one, data/end-user-talks.json was exactly that -- no validator, and the only
// tests that read it were rendering contracts, as the header of
// tests/end-user-talks-data.test.mjs records. It shipped, was rendered on
// /events, and nothing in the suite objected -- because nothing in the suite
// asks the question. The next collector to add a `data/<new>.json` gets the
// same silence.
//
// So this file asks it once, over the directory listing rather than a
// registry: a hand-maintained list of datasets would need editing by the same
// commit that adds the ungated file, which is precisely the commit that would
// forget. Enumerating data/ means a new dataset is in scope the moment it is
// committed, and the test fails until something reads it.
//
// Scope is data/*.json, top level only. data/architectures/ holds imported
// per-architecture content rather than a dataset, and has gates of its own in
// scripts/validate-architectures.mjs and scripts/validate-architecture-assets.mjs.
//
// This is a floor, not a claim of quality. "Something parses this file" is a
// far weaker property than "this file is valid", and a reader that merely
// imports a dataset to render a fixture still satisfies it. The point is that
// the dataset cannot be invisible: it fails here while it has no reader at
// all, which is when the omission is cheapest to fix.
//
// The two scanners take their dataset list, allowlist and reader lookup as
// arguments so the fixtures at the bottom can prove each one actually reports
// the case it exists for. A guard nobody has seen go red is indistinguishable
// from one that always passes -- the reasoning
// tests/ci-playwright-trace-evidence.test.mjs gives for the same shape.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = join(repoRoot, 'data');
const SCRIPTS_DIR = join(repoRoot, 'scripts');
const TESTS_DIR = join(repoRoot, 'tests');

// This file reads data/ by listing it, so it names no dataset literally and
// cannot gate one by accident. Excluded anyway: a future edit that did name a
// dataset here would otherwise make that dataset gate itself, which is the one
// failure mode this test cannot afford.
const SELF = 'data-gate-contract.test.mjs';

// `<dataset>` -> why nothing reads it. Follows the allowlist convention of
// tests/ci-playwright-trace-evidence.test.mjs and tests/ci-gating-jobs.test.mjs:
// an ungated dataset stays possible, but it is argued for here rather than
// shipping as an omission, and the staleness scanner deletes the entry once the
// dataset acquires a reader.
const UNGATED_DATASETS = new Map();

/**
 * Every `.mjs` file under a directory, recursively, with its text.
 *
 * Recursive because scripts/lib/ holds readers too: data/community-people.json
 * reaches a validator through scripts/lib/profile-image.mjs rather than from
 * scripts/validate-community-people.mjs directly, and a non-recursive scan
 * would call that dataset ungated.
 *
 * The listing is a snapshot, and the suite runs its files in parallel: the
 * tests/coverage-report-unmapped-sources.test.mjs fixture writes a
 * `tests/drift-<id>.test.mjs` into the real tree and removes it again a
 * moment later (it has to live here; the reporter maps only repository-rooted
 * files). A file that is gone by the time it is read has no readers to
 * contribute, so ENOENT skips it. Any other error is still the scan's to
 * report: a file that exists and cannot be read would otherwise disappear
 * from the question this test asks.
 *
 * @param {string} dir - directory to walk
 * @param {string[]} [skip] - basenames to leave out
 * @param {(path: string, encoding: string) => string} [read] - file reader
 * @returns {Array<{path: string, text: string}>}
 */
export function readerSources(dir, skip = [], read = readFileSync) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...readerSources(join(dir, entry.name), skip, read));
      continue;
    }
    if (!entry.name.endsWith('.mjs')) continue;
    if (skip.includes(entry.name)) continue;
    const path = join(dir, entry.name);
    try {
      found.push({ path, text: read(path, 'utf8') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return found;
}

/**
 * Datasets that nothing reads and that the allowlist does not excuse.
 *
 * @param {string[]} names - dataset basenames
 * @param {Map<string, string>} allowlist - dataset to why nothing reads it
 * @param {(name: string) => string[]} readersFor - readers of a dataset
 * @returns {string[]} sorted dataset basenames
 */
export function ungatedDatasets(names, allowlist, readersFor) {
  return names
    .filter((name) => !allowlist.has(name))
    .filter((name) => readersFor(name).length === 0)
    .sort();
}

/**
 * Allowlist entries that no longer describe the repository.
 *
 * An entry is stale once its dataset is gone, or once something reads it: in
 * both cases the exemption is now a claim about nothing, and leaving it would
 * silently excuse a future dataset of the same name. An entry with no reason
 * is reported by the same scanner rather than by a separate loop over the
 * allowlist -- an unargued exemption is the same defect, and folding it in
 * here is what lets the fixtures below reach it while the real allowlist is
 * empty.
 *
 * @param {string[]} names - dataset basenames
 * @param {Map<string, string>} allowlist - dataset to why nothing reads it
 * @param {(name: string) => string[]} readersFor - readers of a dataset
 * @returns {string[]} sorted descriptions of the stale entries
 */
export function staleAllowlistEntries(names, allowlist, readersFor) {
  const stale = [];
  for (const [name, reason] of allowlist) {
    if (typeof reason !== 'string' || reason.length === 0) {
      stale.push(`${name} (must record why nothing reads it)`);
      continue;
    }
    if (!names.includes(name)) {
      stale.push(`${name} (no such dataset under data/)`);
      continue;
    }
    if (readersFor(name).length > 0) {
      stale.push(`${name} (now has a reader - delete this entry)`);
    }
  }
  return stale.sort();
}

const datasets = readdirSync(DATA_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();

const sources = [
  ...readerSources(SCRIPTS_DIR),
  ...readerSources(TESTS_DIR, [SELF]),
];

/**
 * The files that name a dataset, as repository-relative paths.
 *
 * Matched on the basename rather than on `data/<name>` because readers spell
 * the path several ways -- `new URL('../data/x.json', import.meta.url)`,
 * `join(repoRoot, 'data', 'x.json')`, `@site/data/x.json`. The basenames in
 * data/ are distinctive enough that a bare-name match does not collide, which
 * the vacuity test below pins.
 *
 * @param {string} dataset - basename of a file in data/
 * @returns {string[]} sorted repository-relative paths of the readers
 */
function readersOf(dataset) {
  return sources
    .filter(({ text }) => text.includes(dataset))
    .map(({ path }) => path.slice(repoRoot.length).replace(/^[/\\]/, ''))
    .sort();
}

test('the scan finds the datasets and the readers to check', () => {
  // Without this the two tests below pass over an empty directory listing or
  // an empty source list and assert nothing at all.
  assert.ok(
    datasets.length > 10,
    `expected the committed datasets under data/; found ${datasets.length}`,
  );
  assert.ok(
    sources.length > 50,
    `expected scripts/ and tests/ sources to scan; found ${sources.length}`,
  );
  // A bare-basename match would be worthless if the names were generic.
  assert.ok(
    datasets.every((name) => name.length > 'x.json'.length),
    'a dataset basename is too short to match on safely',
  );
  // The scan must not be able to satisfy itself; see SELF above.
  assert.ok(
    !sources.some(({ path }) => path.endsWith(SELF)),
    'this file must be excluded from the sources it scans',
  );
});

test('every committed dataset under data/ is read by a validator or a test', () => {
  const ungated = ungatedDatasets(datasets, UNGATED_DATASETS, readersOf);
  assert.deepEqual(
    ungated,
    [],
    'datasets under data/ that no script or test reads, so nothing in CI ' +
      `would notice if their contents were wrong:\n${ungated.join('\n')}\n` +
      'Add a scripts/validate-*.mjs wired to a validate:* script, or a ' +
      'contract test under tests/ that parses the file and asserts its shape.',
  );
});

test('the ungated allowlist is argued for and does not outlive its datasets', () => {
  assert.deepEqual(
    staleAllowlistEntries(datasets, UNGATED_DATASETS, readersOf),
    [],
    'stale entries in UNGATED_DATASETS',
  );
});

// Fixtures. Each proves one scanner reports the case it exists for, against
// synthetic inputs rather than the repository, so they keep their meaning on
// the day the real data stops exercising the arm.
const GATED = (name) => (name === 'gated.json' ? ['tests/gated.test.mjs'] : []);

test('a dataset nothing reads is reported', () => {
  assert.deepEqual(
    ungatedDatasets(['orphan.json', 'gated.json'], new Map(), GATED),
    ['orphan.json'],
  );
});

test('an allowlisted dataset nothing reads is not reported', () => {
  assert.deepEqual(
    ungatedDatasets(
      ['orphan.json'],
      new Map([['orphan.json', 'argued for here']]),
      GATED,
    ),
    [],
  );
});

test('an allowlist entry whose dataset gained a reader is stale', () => {
  assert.deepEqual(
    staleAllowlistEntries(
      ['gated.json'],
      new Map([['gated.json', 'argued for here']]),
      GATED,
    ),
    ['gated.json (now has a reader - delete this entry)'],
  );
});

test('an allowlist entry whose dataset is gone is stale', () => {
  assert.deepEqual(
    staleAllowlistEntries(
      ['gated.json'],
      new Map([['deleted.json', 'argued for here']]),
      GATED,
    ),
    ['deleted.json (no such dataset under data/)'],
  );
});

test('an allowlist entry with no reason is stale', () => {
  assert.deepEqual(
    staleAllowlistEntries(
      ['orphan.json'],
      new Map([['orphan.json', '']]),
      GATED,
    ),
    ['orphan.json (must record why nothing reads it)'],
  );
});

test('an allowlist entry that still describes the repository is not stale', () => {
  assert.deepEqual(
    staleAllowlistEntries(
      ['orphan.json'],
      new Map([['orphan.json', 'argued for here']]),
      GATED,
    ),
    [],
  );
});

// A file that vanishes between the listing and the read is the race
// described on readerSources; the reader is injected because the window is
// too narrow to reproduce on a real filesystem.
test('a source that vanishes after it is listed is skipped, not fatal', () => {
  const root = mkdtempSync(join(tmpdir(), 'data-gate-'));
  try {
    writeFileSync(join(root, 'kept.mjs'), "read('kept.json');\n");
    writeFileSync(join(root, 'drift-1234abcd.test.mjs'), '');
    const vanished = (path, encoding) => {
      if (path.endsWith('drift-1234abcd.test.mjs')) {
        throw Object.assign(new Error('ENOENT: no such file'), {
          code: 'ENOENT',
        });
      }
      return readFileSync(path, encoding);
    };
    assert.deepEqual(readerSources(root, [], vanished), [
      { path: join(root, 'kept.mjs'), text: "read('kept.json');\n" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a source that exists but cannot be read still fails the scan', () => {
  const root = mkdtempSync(join(tmpdir(), 'data-gate-'));
  try {
    writeFileSync(join(root, 'locked.mjs'), '');
    const denied = () => {
      throw Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
    };
    assert.throws(() => readerSources(root, [], denied), { code: 'EACCES' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The real scan must agree with the fixtures about what a reader looks like,
// or the fixtures above describe a function the repository never calls.
test('the real reader lookup finds the gates this repository has', () => {
  assert.ok(
    readersOf('community-roster.json').includes(
      'tests/community-roster-data.test.mjs',
    ),
    'expected the contract test that reads data/community-roster.json',
  );
  assert.ok(
    readersOf('members.json').includes('scripts/validate-members.mjs'),
    'expected the validator that gates data/members.json',
  );
  assert.deepEqual(
    readersOf('definitely-not-a-committed-dataset.json'),
    [],
    'a name absent from the repository must resolve to no readers',
  );
});
