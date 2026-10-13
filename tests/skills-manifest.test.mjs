// Guards the skill index in docs/skills/manifest.md against drift.
//
// AGENTS.md calls that manifest the "Index of all available agent skills" and
// tells agents to "use the `docs/skills/` manifest to discover" the detailed
// guidance, and CONTRIBUTING.md sends them to the same table. Discovery is
// therefore the table, not the directory: a skill file that no row names is a
// file no agent is told to read, and a row naming a file that was renamed or
// removed sends one to a path that does not exist. Both directions are a
// hand-maintained markdown table away from the tree they describe, and both
// are silent in a green build -- adding docs/skills/submission.md required a
// separate manual edit to this table (#1368), and nothing would have failed
// had that edit been forgotten.
//
// tests/sitemap-exclusions.test.mjs already walks docs/skills, but for the
// opposite property: that every file there is `unlisted: true` and matched by
// a sitemap ignorePattern, i.e. that none of them reaches the public sitemap.
// A skill file can satisfy all of that and still be absent from the manifest.
// tests/docs-contract.test.mjs asserts frontmatter, not cross-file indexes.
//
// The assertions below are a set comparison in both directions plus a link
// check, and they are expressed as a pure function over the manifest text so
// the fixtures can prove the guard actually goes red on each kind of drift.
// A guard nobody has seen fail is indistinguishable from one that cannot.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skillsRoot = join(repoRoot, 'docs', 'skills');
const MANIFEST = 'manifest.md';

/**
 * Split a markdown table into its body rows.
 *
 * The delimiter row is the boundary rather than a fixed offset so a table
 * that grows a caption or a blank line above it still parses. A table with
 * no delimiter row is not a table at all: throwing there keeps a manifest
 * whose index was reduced to prose from reading as "zero rows, no drift".
 *
 * @param {string} text markdown containing exactly one table
 * @returns {string[][]} trimmed cells, one array per body row
 */
function tableRows(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  const delimiter = lines.findIndex((line) => /^\|[\s:|-]+\|$/.test(line));
  assert.notEqual(
    delimiter,
    -1,
    'docs/skills/manifest.md must index the skills as a markdown table',
  );
  return lines.slice(delimiter + 1).map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
}

/**
 * Read the link out of a manifest "Entry Point" cell.
 *
 * @param {string} cell the cell text
 * @returns {{label: string, target: string}|null} null when the cell holds no link
 */
function entryPoint(cell) {
  const match = /\[([^\]]+)\]\(([^)]+)\)/.exec(cell);
  return match === null ? null : { label: match[1], target: match[2] };
}

/**
 * Compare the manifest table against the skill files on disk.
 *
 * Returns every disagreement rather than the first so a rename that breaks
 * both directions reports as one failure naming both, not as two runs.
 *
 * @param {string} text contents of docs/skills/manifest.md
 * @param {string[]} skillFiles skill filenames, excluding the manifest itself
 * @returns {string[]} human-readable problems; empty when the index is exact
 */
function manifestProblems(text, skillFiles) {
  const problems = [];
  const listed = new Set();
  for (const cells of tableRows(text)) {
    const skill = cells[0];
    const link = entryPoint(cells[cells.length - 1]);
    if (link === null) {
      problems.push(`${skill} has no entry-point link`);
      continue;
    }
    if (listed.has(link.target)) {
      problems.push(`${link.target} is listed more than once`);
    }
    listed.add(link.target);
    if (!skillFiles.includes(link.target)) {
      problems.push(
        `${link.target} is linked by ${skill} but is not a file in docs/skills`,
      );
    }
    if (link.label !== `docs/skills/${link.target}`) {
      problems.push(
        `${skill} links ${link.target} but reads "${link.label}"; the two must name the same file`,
      );
    }
  }
  for (const file of skillFiles) {
    if (!listed.has(file)) {
      problems.push(
        `docs/skills/${file} is not listed in the manifest, so nothing tells an agent it exists`,
      );
    }
  }
  return problems;
}

const skillFiles = readdirSync(skillsRoot)
  .filter((entry) => entry.endsWith('.md'))
  .filter((entry) => entry !== MANIFEST)
  .sort();

const manifestText = readFileSync(join(skillsRoot, MANIFEST), 'utf8');

test('docs/skills holds skills for the manifest to index', () => {
  assert.ok(
    skillFiles.length > 0,
    'docs/skills contains no skill files; drop the manifest along with the tree',
  );
});

test('the manifest indexes exactly the skill files on disk', () => {
  assert.deepEqual(manifestProblems(manifestText, skillFiles), []);
});

// Fixtures. Each one is the manifest shape with a single defect, so a failure
// here names the drift the guard stopped detecting rather than "the table
// changed".
const HEADER = [
  '| Skill | Purpose | Entry Point |',
  '| :---- | :------ | :---------- |',
].join('\n');

function fixture(...rows) {
  return [HEADER, ...rows].join('\n');
}

const row = (name, file) =>
  `| **${name}** | why | [docs/skills/${file}](${file}) |`;

test('an unlisted skill file is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture(row('A', 'a.md')), ['a.md', 'b.md']),
    [
      'docs/skills/b.md is not listed in the manifest, so nothing tells an agent it exists',
    ],
  );
});

test('a row pointing at a missing file is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture(row('A', 'a.md'), row('Gone', 'gone.md')), [
      'a.md',
    ]),
    ['gone.md is linked by **Gone** but is not a file in docs/skills'],
  );
});

test('a duplicated entry point is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture(row('A', 'a.md'), row('Again', 'a.md')), ['a.md']),
    ['a.md is listed more than once'],
  );
});

test('a row whose label and target disagree is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture('| **A** | why | [docs/skills/b.md](a.md) |'), [
      'a.md',
    ]),
    [
      '**A** links a.md but reads "docs/skills/b.md"; the two must name the same file',
    ],
  );
});

test('a row with no link at all is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture('| **A** | why | docs/skills/a.md |'), ['a.md']),
    [
      '**A** has no entry-point link',
      'docs/skills/a.md is not listed in the manifest, so nothing tells an agent it exists',
    ],
  );
});

test('an index that is no longer a table fails loudly', () => {
  assert.throws(
    () => manifestProblems('See docs/skills/a.md for details.', ['a.md']),
    /must index the skills as a markdown table/,
  );
});
