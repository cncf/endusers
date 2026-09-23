import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// data/milestones.json is consumed by .github/workflows/create-milestones.yml
// through jq and gh, and is documented in MILESTONES.md. Neither consumer
// validates it: a shape error surfaces only as a failed (or silently wrong)
// workflow run, and doc/data drift surfaces only as a wrong milestone in the
// GitHub UI. These tests assert both contracts against the committed data.

const data = JSON.parse(
  readFileSync(new URL('../data/milestones.json', import.meta.url), 'utf8'),
);
const doc = readFileSync(new URL('../MILESTONES.md', import.meta.url), 'utf8');

/**
 * Parse the milestone sections of MILESTONES.md.
 *
 * A section is a `## Milestone: <title>` heading. Its description is the
 * `**Description**:` paragraph, unwrapped to a single line. Its issue numbers
 * are the `#<n>` references inside the bullet list introduced by a line
 * starting with `Tag`, including inclusive ranges such as `#41-#43`. Prose
 * outside that bullet list is ignored, because MILESTONES.md also mentions
 * issues that belong to other milestones.
 *
 * @param {string} markdown - Contents of MILESTONES.md
 * @returns {Array<{title: string, description: string|null, issues: number[]}>}
 */
export function parseMilestonesDoc(markdown) {
  return markdown
    .split(/^## /m)
    .filter((section) => section.startsWith('Milestone: '))
    .map((section) => {
      const lines = section.split('\n');
      const title = lines[0].replace('Milestone: ', '').trim();

      const described = section.match(
        /\*\*Description\*\*:\s*([\s\S]*?)\n\s*\n/,
      );
      const description = described
        ? described[1].replace(/\s+/g, ' ').trim()
        : null;

      const issues = new Set();
      let inTagList = false;
      for (const line of lines.slice(1)) {
        if (/^Tag\b/.test(line)) {
          inTagList = true;
          continue;
        }
        if (!inTagList) continue;
        if (line.trim() === '') continue;
        // A bullet, or an indented continuation of one. Anything else ends
        // the list and returns the parser to prose.
        if (!/^\s*-\s|^\s+\S/.test(line)) {
          inTagList = false;
          continue;
        }
        for (const match of line.matchAll(
          /#(\d+)(?:\s*[\u2013\u2014-]\s*#(\d+))?/g,
        )) {
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : start;
          for (let n = start; n <= end; n += 1) issues.add(n);
        }
      }

      return { title, description, issues: [...issues].sort((a, b) => a - b) };
    });
}

const sorted = (numbers) => [...numbers].sort((a, b) => a - b);

test('parseMilestonesDoc extracts title, unwrapped description and issues', () => {
  const parsed = parseMilestonesDoc(
    [
      '# Heading',
      '',
      '## Milestone: Example',
      '',
      '**Description**: One sentence that is',
      'wrapped across two lines.',
      '',
      'Tag these issues:',
      '',
      '- #1 (first)',
      '- #3, PR #4 (second)',
      '',
      'Depends on: PR #99, which is prose and must not be collected.',
      '',
    ].join('\n'),
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Example');
  assert.equal(
    parsed[0].description,
    'One sentence that is wrapped across two lines.',
  );
  assert.deepEqual(parsed[0].issues, [1, 3, 4]);
});

test('parseMilestonesDoc expands inclusive issue ranges', () => {
  const parsed = parseMilestonesDoc(
    [
      '## Milestone: Range',
      '',
      'Tag these:',
      '',
      '- PRs #41\u2013#43',
      '',
    ].join('\n'),
  );

  assert.deepEqual(parsed[0].issues, [41, 42, 43]);
});

test('parseMilestonesDoc returns no issues for a section without a tag list', () => {
  const parsed = parseMilestonesDoc(
    [
      '## Milestone: Planned',
      '',
      '**Description**: Nothing assigned yet.',
      '',
      'Tag issues/PRs covering:',
      '',
      '- DNS cutover',
      '',
    ].join('\n'),
  );

  assert.deepEqual(parsed[0].issues, []);
});

test('milestones.json has a non-empty milestones array', () => {
  assert.ok(
    data && typeof data === 'object' && !Array.isArray(data),
    'top level must be an object',
  );
  assert.ok(Array.isArray(data.milestones), 'milestones must be an array');
  assert.ok(data.milestones.length > 0, 'milestones must not be empty');
});

test('every milestone has a title the workflow can look up', () => {
  for (const milestone of data.milestones) {
    assert.ok(
      milestone && typeof milestone === 'object' && !Array.isArray(milestone),
      'each milestone must be an object',
    );
    assert.equal(
      typeof milestone.title,
      'string',
      `title must be a string: ${JSON.stringify(milestone)}`,
    );
    assert.ok(milestone.title.trim().length > 0, 'title must not be blank');
    // The workflow resolves an existing milestone with
    // `awk -F '\t' -v title=...`, so a tab or newline in a title would split
    // the lookup key and silently create a duplicate milestone instead.
    assert.doesNotMatch(
      milestone.title,
      /[\t\n\r]/,
      `title must not contain tabs or newlines: ${milestone.title}`,
    );
  }
});

test('milestone titles are unique', () => {
  const titles = data.milestones.map((milestone) => milestone.title);
  assert.deepEqual(
    titles,
    [...new Set(titles)],
    'duplicate titles collapse into one GitHub milestone',
  );
});

test('every milestone has a non-empty description', () => {
  for (const milestone of data.milestones) {
    // `jq -r '.description'` prints the string "null" for a missing key, and
    // the workflow would post that literally as the milestone description.
    assert.equal(
      typeof milestone.description,
      'string',
      `description must be a string: ${milestone.title}`,
    );
    assert.ok(
      milestone.description.trim().length > 0,
      `description must not be blank: ${milestone.title}`,
    );
  }
});

test('every milestone has an issues array of positive integers', () => {
  for (const milestone of data.milestones) {
    // `jq -r '.issues[]'` fails under `set -o pipefail` when the key is
    // missing, aborting the whole workflow run.
    assert.ok(
      Array.isArray(milestone.issues),
      `issues must be an array: ${milestone.title}`,
    );
    for (const issue of milestone.issues) {
      assert.ok(
        Number.isSafeInteger(issue) && issue > 0,
        `issue must be a positive integer, got ${JSON.stringify(issue)} in ${milestone.title}`,
      );
    }
  }
});

test('no issue is listed under two milestones', () => {
  // GitHub allows one milestone per issue, so a second assignment silently
  // overwrites the first and the earlier milestone loses the item.
  const seen = new Map();
  for (const milestone of data.milestones) {
    for (const issue of milestone.issues) {
      const previous = seen.get(issue);
      assert.equal(
        previous,
        undefined,
        `issue #${issue} is listed under both "${previous}" and "${milestone.title}"`,
      );
      seen.set(issue, milestone.title);
    }
  }
});

test('no milestone lists the same issue twice', () => {
  for (const milestone of data.milestones) {
    assert.deepEqual(
      sorted(milestone.issues),
      sorted(new Set(milestone.issues)),
      `duplicate issue numbers in ${milestone.title}`,
    );
  }
});

test('MILESTONES.md documents the same milestones in the same order', () => {
  const documented = parseMilestonesDoc(doc).map(
    (milestone) => milestone.title,
  );
  assert.deepEqual(
    documented,
    data.milestones.map((milestone) => milestone.title),
    'MILESTONES.md headings have drifted from data/milestones.json',
  );
});

test('MILESTONES.md descriptions match data/milestones.json', () => {
  const documented = new Map(
    parseMilestonesDoc(doc).map((milestone) => [
      milestone.title,
      milestone.description,
    ]),
  );
  for (const milestone of data.milestones) {
    assert.equal(
      documented.get(milestone.title),
      milestone.description,
      `description drift for "${milestone.title}"`,
    );
  }
});

test('MILESTONES.md issue assignments match data/milestones.json', () => {
  const documented = new Map(
    parseMilestonesDoc(doc).map((milestone) => [
      milestone.title,
      milestone.issues,
    ]),
  );
  for (const milestone of data.milestones) {
    assert.deepEqual(
      documented.get(milestone.title),
      sorted(milestone.issues),
      `issue assignment drift for "${milestone.title}"`,
    );
  }
});
