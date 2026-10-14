// Pins the `src/**` and `scripts/**` line numbers the test tree cites in prose.
//
// The end-to-end lane documents itself by line number. The residual note in
// tests/e2e-coverage-gate.test.mjs names the exact regions the union cannot
// credit, every data overlay under tests/e2e/fixtures/ explains in its
// `description` which arm it exists to reach, and the specs that drive those
// arms quote the guard they are about. That is the only record of *why* a
// fixture build exists, and tests/tools/e2e-data-fixtures.cjs already refuses
// an overlay whose `description` is empty.
//
// A line number is the one kind of citation that rots without anybody editing
// it. `refactor: share formatDate() between PeopleFreshness and MemberDirectory`
// (#1400) moved formatDate out of src/components/MemberDirectory/utils.js and
// src/components/PeopleFreshness/index.js into src/components/shared/formatDate.js.
// Nothing in the test tree changed, every check stayed green, and six citations
// across five files went on naming lines that had moved or stopped existing --
// `utils.js:42-44` into a file 38 lines long, `utils.js line 16` at the
// Number.isNaN guard that is now `membershipLabel`, and PeopleFreshness's
// `!fetchedAt` guard at line 22 of a 19-line file.
//
// The damage is not cosmetic. A reader who follows `utils.js line 16` to decide
// whether an overlay still earns its build reads an unrelated function and
// concludes the overlay is stale, or keeps a build nobody needs. The gate test's
// residual list is the argument for not ratcheting --check-source-regions above
// 97; an entry pointing at nothing is an argument nobody can check.
//
// So: a cited line has to exist and has to carry code. Citing a blank line or a
// comment is how a stale citation looks once the lines below it have shifted,
// which is exactly the #1400 shape. The scan is confined to `src/**` and
// `scripts/**` because those are the trees a production refactor moves; a
// citation into the test tree is checked by nothing here.
//
// This cannot pin *meaning* -- a citation that lands on the wrong statement
// still reads as code -- so it is a floor, not a proof. It catches the drift
// that a refactor causes mechanically, which is the drift that happens.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'tests/source-line-citations.test.mjs';

// The trees whose line numbers a production refactor moves.
const CITED_ROOTS = ['src/', 'scripts/'];

// Both forms the repository already writes: `path/to/file.js:42-44` and
// `path/to/file.js line 16` / `lines 14-22`. A bare `utils.js line 16` with no
// directory is deliberately not matched -- there is no way to resolve it to a
// file, and inventing one would make this guard fail on prose it cannot check.
const CITATION =
  /((?:src|scripts)\/[A-Za-z0-9._/-]+\.(?:js|mjs|cjs|jsx))(?::(\d+)(?:-(\d+))?|\s+lines?\s+(\d+)(?:-(\d+))?)/g;

export function parseCitations(text) {
  const found = [];
  for (const match of text.matchAll(CITATION)) {
    const [, path, colonStart, colonEnd, wordStart, wordEnd] = match;
    const start = Number(colonStart ?? wordStart);
    const end = Number(colonEnd ?? wordEnd ?? start);
    found.push({ path, start, end });
  }
  return found;
}

// Blank and comment-only lines are reported separately from a line that does
// not exist at all: the first two are a citation that slid, the third is a
// citation into a file that shrank, and the distinction is what tells a reader
// how far to look.
export function citationFault({ path, start, end }, readLines) {
  const lines = readLines(path);
  if (lines === null) return 'no such file';
  if (end > lines.length)
    return `cites line ${end}, but the file has ${lines.length}`;
  for (let line = start; line <= end; line += 1) {
    const text = lines[line - 1].trim();
    if (text === '') return `cites line ${line}, which is blank`;
    if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*'))
      return `cites line ${line}, which is a comment`;
  }
  return null;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(mjs|cjs|js|json)$/.test(entry.name)) found.push(full);
  }
  return found;
}

function readRepoLines(path) {
  const full = join(repoRoot, path);
  try {
    if (!statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  const text = readFileSync(full, 'utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

test('every src/ and scripts/ line the test tree cites still carries code', () => {
  const faults = [];
  let counted = 0;
  for (const file of walk(join(repoRoot, 'tests'))) {
    const origin = relative(repoRoot, file);
    // This file's own parser fixtures below are sample text, not claims about
    // the repository, so scanning it would report them as stale citations.
    if (origin === SELF) continue;
    for (const citation of parseCitations(readFileSync(file, 'utf8'))) {
      counted += 1;
      const fault = citationFault(citation, readRepoLines);
      if (fault) faults.push(`${origin}: ${citation.path} ${fault}`);
    }
  }
  assert.deepEqual(faults, [], `stale source citations:\n${faults.join('\n')}`);
  // A parser that matched nothing would pass the assertion above while
  // checking nothing at all, which is the one failure this guard cannot
  // report on itself.
  assert.ok(
    counted >= 20,
    `expected the test tree to cite ${CITED_ROOTS.join(' and ')} lines, found ${counted}`,
  );
});

test('both citation spellings are parsed, and bare filenames are not', () => {
  assert.deepEqual(
    parseCitations(
      'see src/components/MemberDirectory/utils.js:34-36 and ' +
        'scripts/lib/url-safety.mjs line 7 and ' +
        'src/lib/profile-links.mjs lines 2-4, but not utils.js line 16 ' +
        'nor tests/tools/fake-dom.mjs:3',
    ),
    [
      { path: 'src/components/MemberDirectory/utils.js', start: 34, end: 36 },
      { path: 'scripts/lib/url-safety.mjs', start: 7, end: 7 },
      { path: 'src/lib/profile-links.mjs', start: 2, end: 4 },
    ],
  );
});

// The guard has to be seen going red, or it is indistinguishable from one that
// always passes. Each case is the shape #1400 left behind.
test('a stale citation is reported, and a live one is not', () => {
  const file = ['const a = 1;', '', '// a note', 'const b = 2;'];
  const readLines = (path) => (path === 'src/x.js' ? file : null);
  const fault = (start, end) =>
    citationFault({ path: 'src/x.js', start, end }, readLines);

  assert.equal(fault(1, 1), null);
  assert.equal(fault(4, 4), null);
  assert.equal(fault(2, 2), 'cites line 2, which is blank');
  assert.equal(fault(3, 3), 'cites line 3, which is a comment');
  assert.equal(fault(1, 3), 'cites line 2, which is blank');
  assert.equal(fault(9, 9), 'cites line 9, but the file has 4');
  assert.equal(
    citationFault({ path: 'src/gone.js', start: 1, end: 1 }, readLines),
    'no such file',
  );
});
