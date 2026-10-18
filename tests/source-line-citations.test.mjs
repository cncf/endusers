// Pins the `src/**` and `scripts/**` line numbers the test tree cites in prose.
//
// The end-to-end lane documents itself by line number. Every data overlay
// under tests/e2e/fixtures/ explains in its `description` which arm it exists
// to reach, and the specs that drive those arms quote the guard they are
// about. That is the only record of *why* a
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
// concludes the overlay is stale, or keeps a build nobody needs. A citation
// pointing at nothing is an argument nobody can check.
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
//
// It also cannot pin what it cannot parse. The e2e lane wrote a second
// spelling for years -- a bare `line 13` or `at lines 32-33` with the file
// named a sentence earlier -- and CITATION deliberately does not match it.
// That left six stale citations across four fixtures and specs with every
// check green (#1439 moved ReferenceArchitectures' guard from 13 to 14 and
// folded CaseStudies' and RadarReports' SyncStatus into the shared
// MirrorSyncStatus; #1414/#1420 rewrote websiteUrl() onto isSafeUrl()). So the
// second check below refuses the bare spelling under tests/e2e/, where a
// `line N` is always a claim about src/** or scripts/**: every such mention
// has to carry its path, which is what puts it under the first check.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkflow, workflowFiles } from './helpers-workflows.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'tests/source-line-citations.test.mjs';

// The trees whose line numbers a production refactor moves.
const CITED_ROOTS = ['src/', 'scripts/'];

// The one spelling of a cited path, shared by both regexes below. They have to
// agree: CITATION decides what counts as a qualified citation, QUALIFIED_BEFORE
// decides what counts as *not* bare, and a path either regex alone accepts is a
// citation reported as bare while never being resolved against the file.
const CITED_PATH = String.raw`(?:src|scripts)\/[A-Za-z0-9._/-]+\.(?:js|mjs|cjs|jsx)`;

// MDX prose spells a path as code, so a closing backtick sits between the path
// and the words: `` `src/components/X/index.js` line 134 ``. The backtick is
// optional here rather than a second spelling, because both regexes take it
// from this one fragment and so cannot disagree about it.
const AFTER_PATH = '`?';

// Both forms the repository already writes: `path/to/file.js:42-44` and
// `path/to/file.js line 16` / `lines 14-22`. A bare `utils.js line 16` with no
// directory is deliberately not matched -- there is no way to resolve it to a
// file, and inventing one would make this guard fail on prose it cannot check.
const CITATION = new RegExp(
  `(${CITED_PATH})(?::(\\d+)(?:-(\\d+))?|${AFTER_PATH}\\s+lines?\\s+(\\d+)(?:-(\\d+))?)`,
  'g',
);

// A `line N` / `lines N-M` whose preceding token is not a source filename.
// Only the token immediately before the word is inspected: "index.js:7" is
// the colon spelling and never reaches here, and "index.js line 7" is the
// qualified word spelling, so anything else in that position is a bare cite.
const LINE_WORD = /\blines?\s+\d+(?:-\d+)?/g;
const QUALIFIED_BEFORE = new RegExp(`${CITED_PATH}${AFTER_PATH}\\s*$`);

export function bareLineCitations(text) {
  const found = [];
  for (const match of text.matchAll(LINE_WORD)) {
    if (!QUALIFIED_BEFORE.test(text.slice(0, match.index))) {
      found.push(match[0]);
    }
  }
  return found;
}

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

// The third tree the test tree cites by line, and the one the doctrine above
// does not cover: `.github/workflows/**`. The prose in tests/ argues about
// what CI does by pointing at the step that does it, and those line numbers
// rot faster than src/**'s -- a workflow grows a step in the middle far more
// often than a module grows a function, and every step below it shifts.
//
// A bare `ci.yml:40` is resolvable in a way a bare `utils.js:40` is not, which
// is why this is matched where CITATION refuses the unqualified spelling:
// GitHub requires every workflow to sit directly in one flat directory, so the
// basename is the whole identity. A name that is not a workflow on disk is not
// a workflow citation at all and is left alone.
const WORKFLOW_DIR = '.github/workflows';
const WORKFLOW_CITATION = /\b([a-z0-9][a-z0-9.-]*\.yml):(\d+)(?:-(\d+))?/g;

export function parseWorkflowCitations(text, isWorkflow) {
  const found = [];
  for (const match of text.matchAll(WORKFLOW_CITATION)) {
    const [, file, start, end] = match;
    if (!isWorkflow(file)) continue;
    found.push({ file, start: Number(start), end: Number(end ?? start) });
  }
  return found;
}

// A workflow citation is a claim about a *step*, so it has to land on one. The
// anchors are the two lines a step is identified by -- its `- name:` and its
// `run:`/`uses:` -- and they are what a reader is being pointed at; every
// other line is a continuation (`fi`, a `with:` value, a heredoc body) or a
// structural key (`jobs:`, a job id, `steps:`).
//
// That distinction is what makes the check survive the drift it exists for.
// When a step is inserted above a cited one, the old number almost always
// still exists and still carries text -- "does this line have code on it" sees
// nothing wrong -- but it has slid off the anchor onto a continuation line or
// into the next job, which is a fault this can name. Only the endpoints are
// constrained: a range's interior is the body of the thing being cited.
const WORKFLOW_ANCHOR = /^\s*(?:-\s+name:|-?\s*(?:run|uses):)/;

export function workflowCitationFault({ file, start, end }, readLines) {
  const lines = readLines(file);
  if (end > lines.length)
    return `cites line ${end}, but ${file} has ${lines.length}`;
  for (const line of [start, end]) {
    if (!WORKFLOW_ANCHOR.test(lines[line - 1]))
      return `cites line ${line}, which is not a step (${lines[line - 1].trim() || 'blank'})`;
  }
  return null;
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

// The extensions the test tree argues in. `.mdx` is here because the e2e
// coverage overlay pages under tests/e2e/fixtures/docs/ are MDX and cite the
// arms they exist to reach exactly the way the JS overlays and specs do; while
// the walk skipped them their citations were checked by neither test below.
// `.jsx` is here for symmetry with the extensions CITATION already resolves.
const SCANNED = /\.(mjs|cjs|js|jsx|json|mdx)$/;

export function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (SCANNED.test(entry.name)) found.push(full);
  }
  return found;
}

function sourceLines(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function readRepoLines(path) {
  const full = join(repoRoot, path);
  try {
    if (!statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return sourceLines(readFileSync(full, 'utf8'));
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

// Every workflow line the test tree cites still names a step.
//
// Same rot as the src/** check above, in the tree that moves most: inserting
// one step into a job shifts every line below it, and the prose that pointed
// at those steps goes on reading as though it still does. `ci: gate exact-clone
// count with jscpd in the lint job` (#1582) is the shape -- a step added to a
// job, every later number off by two, nothing red.
test('every workflow line the test tree cites still names a step', () => {
  // Read through tests/helpers-workflows.mjs: tests/workflow-loader.test.mjs
  // reserves every direct read of the workflow directory to that module.
  const sources = new Map(
    workflowFiles().map((name) => [name, readWorkflow(name).source]),
  );
  const isWorkflow = (file) => sources.has(file);
  const readWorkflowLines = (file) => sourceLines(sources.get(file));

  const faults = [];
  let counted = 0;
  for (const file of walk(join(repoRoot, 'tests'))) {
    const origin = relative(repoRoot, file);
    if (origin === SELF) continue;
    const text = readFileSync(file, 'utf8');
    for (const citation of parseWorkflowCitations(text, isWorkflow)) {
      counted += 1;
      const fault = workflowCitationFault(citation, readWorkflowLines);
      if (fault) faults.push(`${origin}: ${citation.file} ${fault}`);
    }
  }
  assert.deepEqual(
    faults,
    [],
    `stale workflow citations:\n${faults.join('\n')}`,
  );
  // Vacuity floor, for the same reason the src/** check carries one: a parser
  // that matched nothing would pass while checking nothing. Kept low because
  // workflow citations are rare by design -- prose should name the gate, not
  // the line, unless the line is the point.
  assert.ok(
    counted >= 2,
    `expected the test tree to cite ${WORKFLOW_DIR} lines, found ${counted}`,
  );
});

// Scoped to tests/e2e/: elsewhere under tests/, "line 3" is a position in a
// synthetic source map or ignore file, not a claim about the production tree.
test('every line the e2e lane cites in prose names its file', () => {
  const bare = [];
  for (const file of walk(join(repoRoot, 'tests', 'e2e'))) {
    const origin = relative(repoRoot, file);
    for (const mention of bareLineCitations(readFileSync(file, 'utf8'))) {
      bare.push(`${origin}: "${mention}" names no src/ or scripts/ file`);
    }
  }
  assert.deepEqual(bare, [], `bare line citations:\n${bare.join('\n')}`);
});

test('a bare line citation is reported, and a qualified one is not', () => {
  assert.deepEqual(
    bareLineCitations(
      'the guard at src/components/X/index.js line 14, ' +
        'the arm at src/lib/y.mjs lines 2-4, ' +
        'and the colon form src/lib/y.mjs:9, ' +
        'but also the fallback at line 76 and the anchors at lines 26-30',
    ),
    ['line 76', 'lines 26-30'],
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

// The MDX spelling has to be parsed and *not* also reported as bare: the two
// regexes read the same text from opposite ends, so a fragment only one of
// them accepts turns a resolved citation into a bare-citation failure. Both
// halves are asserted on one string for that reason.
test('the MDX backtick spelling is a qualified citation, not a bare one', () => {
  const prose =
    'resolves its roster with `peopleData.people[section] || []`\n' +
    '(`src/components/CommunityPeople/index.js` line 134), and the arm at\n' +
    '`src/lib/y.mjs` lines 2-4, and the colon form `src/lib/y.mjs:9`';

  assert.deepEqual(parseCitations(prose), [
    { path: 'src/components/CommunityPeople/index.js', start: 134, end: 134 },
    { path: 'src/lib/y.mjs', start: 2, end: 4 },
    { path: 'src/lib/y.mjs', start: 9, end: 9 },
  ]);
  assert.deepEqual(bareLineCitations(prose), []);
});

// The citation above is only checked while the walk reaches the file holding
// it. An extension dropping back out of SCANNED would leave every test here
// green -- the parser cases are strings, and faults over an unread tree is an
// empty list -- so the reach is asserted directly.
test('the walk reaches the e2e MDX overlay pages', () => {
  const scanned = walk(join(repoRoot, 'tests')).map((file) =>
    relative(repoRoot, file),
  );
  assert.ok(
    scanned.includes('tests/e2e/fixtures/docs/community-people.mdx'),
    'the walk no longer reaches tests/e2e/fixtures/docs/*.mdx',
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

test('workflow citations are parsed, and non-workflow .yml names are not', () => {
  const isWorkflow = (file) => file === 'ci.yml' || file === 'codeql.yml';
  assert.deepEqual(
    parseWorkflowCitations(
      'the gate at ci.yml:35, the validate steps at ci.yml:50-75, ' +
        'the scan at codeql.yml:12, but not .markdownlint.yaml:4 ' +
        'nor pnpm-lock.yml:9',
      isWorkflow,
    ),
    [
      { file: 'ci.yml', start: 35, end: 35 },
      { file: 'ci.yml', start: 50, end: 75 },
      { file: 'codeql.yml', start: 12, end: 12 },
    ],
  );
});

// Red is the only proof. Each case is the #1582 shape: a step inserted above
// the cited one, leaving a number that still exists and still carries text
// while no longer naming the step the prose is about.
test('a workflow citation that slid off its step is reported', () => {
  const workflow = [
    '  validate:',
    '    steps:',
    '      - name: Run unit tests',
    '        run: npm run test:unit',
    '        shell: bash',
    '',
    '      - name: Build site',
    '        run: npm run build',
    '      - uses: ./.github/actions/setup-node-deps',
  ];
  const fault = (start, end) =>
    workflowCitationFault({ file: 'ci.yml', start, end }, () => workflow);

  assert.equal(fault(3, 3), null);
  assert.equal(fault(4, 4), null);
  assert.equal(fault(3, 8), null);
  // `uses:` anchors a step as surely as `run:` does.
  assert.equal(fault(9, 9), null);
  assert.equal(fault(5, 5), 'cites line 5, which is not a step (shell: bash)');
  assert.equal(fault(6, 6), 'cites line 6, which is not a step (blank)');
  assert.equal(fault(3, 1), 'cites line 1, which is not a step (validate:)');
  assert.equal(fault(11, 11), 'cites line 11, but ci.yml has 9');
});
