// Guards the skill index in .agents/skills/manifest.md against drift.
//
// AGENTS.md calls that manifest the "Index of all available agent skills" and
// tells agents to "use the `.agents/skills/` manifest to discover" the
// detailed guidance, and CONTRIBUTING.md sends them to the same table.
// Discovery is therefore the table, not the directory: a skill that no row
// names is a skill no agent is told to read, and a row naming a skill that
// was renamed or removed sends one to a path that does not exist. Both
// directions are a hand-maintained markdown table away from the tree they
// describe, and both are silent in a green build -- adding the submission
// skill required a separate manual edit to this table (#1368), and nothing
// would have failed had that edit been forgotten.
//
// The tree follows the Agent Skills layout (https://agentskills.io): one
// `<name>/SKILL.md` per skill, whose front matter carries a `name` equal to
// the directory and a `description` saying when to use it. Nothing in the
// build reads .agents/, so this file is the only gate on that shape too.
//
// The assertions below are a set comparison in both directions plus a link
// check, and they are expressed as a pure function over the manifest text so
// the fixtures can prove the guard actually goes red on each kind of drift.
// A guard nobody has seen fail is indistinguishable from one that cannot.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skillsRoot = join(repoRoot, '.agents', 'skills');
const MANIFEST = 'manifest.md';
const SKILL_FILE = 'SKILL.md';
const LABEL_PREFIX = '.agents/skills/';

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
    '.agents/skills/manifest.md must index the skills as a markdown table',
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
 * @param {string} text contents of .agents/skills/manifest.md
 * @param {string[]} skillFiles skill entry points relative to .agents/skills,
 *   e.g. `doc-authoring/SKILL.md`
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
        `${link.target} is linked by ${skill} but is not a file in .agents/skills`,
      );
    }
    if (link.label !== `${LABEL_PREFIX}${link.target}`) {
      problems.push(
        `${skill} links ${link.target} but reads "${link.label}"; the two must name the same file`,
      );
    }
  }
  for (const file of skillFiles) {
    if (!listed.has(file)) {
      problems.push(
        `${LABEL_PREFIX}${file} is not listed in the manifest, so nothing tells an agent it exists`,
      );
    }
  }
  return problems;
}

const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const skillFiles = skillDirs.map((dir) => `${dir}/${SKILL_FILE}`);

const manifestText = readFileSync(join(skillsRoot, MANIFEST), 'utf8');

/**
 * Read a top-level front matter value, or undefined when the key is absent.
 * Folded multi-line values (`key:` followed by indented lines) are joined so a
 * wrapped description still counts as present.
 *
 * @param {string} text file contents
 * @param {string} key front matter key
 * @returns {string|undefined}
 */
function frontmatterValue(text, key) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const match = new RegExp(
    `^${key}:[ \\t]*(.*)((?:\\r?\\n[ \\t]+.*)*)`,
    'm',
  ).exec(block);
  if (match === null) return undefined;
  return `${match[1]}${match[2]}`.replace(/\s+/g, ' ').trim();
}

test('.agents/skills holds skills for the manifest to index', () => {
  assert.ok(
    skillDirs.length > 0,
    '.agents/skills contains no skill directories; drop the manifest along with the tree',
  );
});

test('every skill directory holds a SKILL.md', () => {
  for (const dir of skillDirs) {
    assert.ok(
      existsSync(join(skillsRoot, dir, SKILL_FILE)),
      `.agents/skills/${dir}/ has no ${SKILL_FILE}; a directory with no entry point cannot be indexed or loaded`,
    );
  }
});

test('every SKILL.md names itself after its directory and says when to use it', () => {
  for (const dir of skillDirs) {
    const text = readFileSync(join(skillsRoot, dir, SKILL_FILE), 'utf8');
    assert.equal(
      frontmatterValue(text, 'name'),
      dir,
      `.agents/skills/${dir}/${SKILL_FILE} must carry "name: ${dir}" so the skill is addressed by the same name on disk and in front matter`,
    );
    assert.ok(
      frontmatterValue(text, 'description'),
      `.agents/skills/${dir}/${SKILL_FILE} needs a non-empty "description" so an agent can decide whether to load it`,
    );
    assert.equal(
      frontmatterValue(text, 'unlisted'),
      undefined,
      `.agents/skills/${dir}/${SKILL_FILE} still carries "unlisted", a Docusaurus key with no meaning outside docs/`,
    );
  }
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
  `| **${name}** | why | [.agents/skills/${file}](${file}) |`;

test('an unlisted skill file is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture(row('A', 'a/SKILL.md')), [
      'a/SKILL.md',
      'b/SKILL.md',
    ]),
    [
      '.agents/skills/b/SKILL.md is not listed in the manifest, so nothing tells an agent it exists',
    ],
  );
});

test('a row pointing at a missing file is reported', () => {
  assert.deepEqual(
    manifestProblems(
      fixture(row('A', 'a/SKILL.md'), row('Gone', 'gone/SKILL.md')),
      ['a/SKILL.md'],
    ),
    ['gone/SKILL.md is linked by **Gone** but is not a file in .agents/skills'],
  );
});

test('a duplicated entry point is reported', () => {
  assert.deepEqual(
    manifestProblems(
      fixture(row('A', 'a/SKILL.md'), row('Again', 'a/SKILL.md')),
      ['a/SKILL.md'],
    ),
    ['a/SKILL.md is listed more than once'],
  );
});

test('a row whose label and target disagree is reported', () => {
  assert.deepEqual(
    manifestProblems(
      fixture('| **A** | why | [.agents/skills/b/SKILL.md](a/SKILL.md) |'),
      ['a/SKILL.md'],
    ),
    [
      '**A** links a/SKILL.md but reads ".agents/skills/b/SKILL.md"; the two must name the same file',
    ],
  );
});

test('a row with no link at all is reported', () => {
  assert.deepEqual(
    manifestProblems(fixture('| **A** | why | .agents/skills/a/SKILL.md |'), [
      'a/SKILL.md',
    ]),
    [
      '**A** has no entry-point link',
      '.agents/skills/a/SKILL.md is not listed in the manifest, so nothing tells an agent it exists',
    ],
  );
});

test('an index that is no longer a table fails loudly', () => {
  assert.throws(
    () =>
      manifestProblems('See .agents/skills/a/SKILL.md for details.', [
        'a/SKILL.md',
      ]),
    /must index the skills as a markdown table/,
  );
});

test('frontmatterValue reads scalar and folded values and ignores the body', () => {
  const text = [
    '---',
    'name: a',
    'description:',
    '  Use when the first line',
    '  wraps onto a second.',
    '---',
    '',
    'unlisted: true',
  ].join('\n');
  assert.equal(frontmatterValue(text, 'name'), 'a');
  assert.equal(
    frontmatterValue(text, 'description'),
    'Use when the first line wraps onto a second.',
  );
  assert.equal(frontmatterValue(text, 'unlisted'), undefined);
  assert.equal(frontmatterValue('# No front matter', 'name'), undefined);
  assert.equal(frontmatterValue('---\ndescription:\n---\n', 'description'), '');
});
