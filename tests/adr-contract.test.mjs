import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const adrDir = fileURLToPath(new URL('../adr', import.meta.url));
const readme = readFileSync(join(adrDir, 'README.md'), 'utf8');

const ALLOWED_STATUSES = new Set([
  'Proposed',
  'Accepted',
  'Rejected',
  'Superseded',
  'Deprecated',
]);

const markdownFiles = readdirSync(adrDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort();

// Files whose name begins with a four-digit sequence number claim an ADR
// number; supporting material that does not is exempt from the number and
// index contracts.
const numberPrefixed = markdownFiles.filter((name) => /^\d{4}-/.test(name));

// | [0001](./0001-slug.md) | Title | Status |
const INDEX_ROW =
  /^\|\s*\[(\d{4})\]\((\.\/[^)]+)\)\s*\|\s*(.+?)\s*\|\s*(\S+)\s*\|\s*$/;

const indexRows = readme
  .split('\n')
  .map((line) => line.match(INDEX_ROW))
  .filter(Boolean)
  .map(([, number, href, title, status]) => ({
    number,
    href,
    title,
    status,
  }));

function readAdr(name) {
  return readFileSync(join(adrDir, name), 'utf8');
}

function headerField(body, field) {
  const match = body.match(
    new RegExp(`^- \\*\\*${field}\\*\\*:\\s*(.+)$`, 'm'),
  );
  return match ? match[1].trim() : null;
}

function heading(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

test('the index table lists at least one ADR', () => {
  assert.ok(
    indexRows.length > 0,
    'adr/README.md must contain a table of ADR rows matching | [NNNN](./file.md) | Title | Status |',
  );
});

test('every indexed ADR links to a file that exists', () => {
  for (const row of indexRows) {
    const target = row.href.replace(/^\.\//, '');
    assert.ok(
      existsSync(join(adrDir, target)),
      `adr/README.md row ${row.number} links to missing file ${row.href}`,
    );
  }
});

test('every indexed ADR links to a file named for its number', () => {
  for (const row of indexRows) {
    const target = row.href.replace(/^\.\//, '');
    assert.ok(
      target.startsWith(`${row.number}-`),
      `adr/README.md row ${row.number} links to ${target}, which is not named for ADR ${row.number}`,
    );
  }
});

test('index numbers are unique', () => {
  const seen = new Set();
  for (const row of indexRows) {
    assert.ok(
      !seen.has(row.number),
      `adr/README.md lists ADR ${row.number} more than once`,
    );
    seen.add(row.number);
  }
});

// A decision record is a number-prefixed file that either heads itself as an
// ADR or is linked from the index; supporting drafts filed alongside them are
// not held to the ADR header contract.
const adrFiles = numberPrefixed.filter(
  (name) =>
    /^ADR\s+\d{4}:/.test(heading(readAdr(name)) ?? '') ||
    indexRows.some((row) => row.href.replace(/^\.\//, '') === name),
);

test('at least one decision record is present', () => {
  assert.ok(adrFiles.length > 0, 'adr/ contains no ADR files');
});

test('every ADR file carries a parseable Date header', () => {
  for (const name of adrFiles) {
    const date = headerField(readAdr(name), 'Date');
    assert.ok(date, `adr/${name} is missing a "- **Date**:" header field`);
    assert.ok(
      !Number.isNaN(Date.parse(date)),
      `adr/${name} has an unparseable Date header: ${date}`,
    );
  }
});

test('every ADR file declares an allowed Status', () => {
  for (const name of adrFiles) {
    const status = headerField(readAdr(name), 'Status');
    assert.ok(status, `adr/${name} is missing a "- **Status**:" header field`);
    assert.ok(
      ALLOWED_STATUSES.has(status),
      `adr/${name} has status "${status}"; expected one of ${[...ALLOWED_STATUSES].join(', ')}`,
    );
  }
});

test('index status matches the status recorded in each ADR file', () => {
  for (const row of indexRows) {
    const target = row.href.replace(/^\.\//, '');
    if (!existsSync(join(adrDir, target))) continue;
    const status = headerField(readAdr(target), 'Status');
    assert.equal(
      row.status,
      status,
      `adr/README.md lists ADR ${row.number} as "${row.status}" but adr/${target} records "${status}"`,
    );
  }
});

test('index title matches the ADR heading', () => {
  for (const row of indexRows) {
    const target = row.href.replace(/^\.\//, '');
    if (!existsSync(join(adrDir, target))) continue;
    const title = heading(readAdr(target));
    assert.ok(title, `adr/${target} is missing an H1 heading`);
    const expected = title.replace(/^ADR\s+\d{4}:\s*/, '');
    assert.equal(
      row.title,
      expected,
      `adr/README.md titles ADR ${row.number} "${row.title}" but adr/${target} heads "${expected}"`,
    );
  }
});

test('every ADR heading names its own file number', () => {
  for (const name of adrFiles) {
    const title = heading(readAdr(name));
    const declared = title?.match(/^ADR\s+(\d{4}):/)?.[1];
    if (!declared) continue;
    assert.equal(
      declared,
      name.slice(0, 4),
      `adr/${name} heads itself "ADR ${declared}" but is filed under ${name.slice(0, 4)}`,
    );
  }
});

test('relative links between ADR files resolve', () => {
  for (const name of [...markdownFiles, 'README.md']) {
    const body = readFileSync(join(adrDir, name), 'utf8');
    for (const [, href] of body.matchAll(/]\((\.\/[^)#]+)[^)]*\)/g)) {
      const target = href.replace(/^\.\//, '');
      assert.ok(
        existsSync(join(adrDir, target)),
        `adr/${name} links to ${href}, which does not exist`,
      );
    }
  }
});

// Known deviation, tracked separately: adr/0001-stakeholder-outreach-draft.md
// takes the 0001 prefix without being ADR 0001, so the directory holds two
// files claiming that number and one of them is absent from the index.
test('each ADR number is claimed by exactly one file', { todo: true }, () => {
  const byNumber = new Map();
  for (const name of numberPrefixed) {
    const number = name.slice(0, 4);
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
  }
  for (const [number, names] of byNumber) {
    assert.equal(
      names.length,
      1,
      `ADR number ${number} is claimed by ${names.length} files: ${names.join(', ')}`,
    );
  }
});

test(
  'every number-prefixed ADR file is listed in the index',
  { todo: true },
  () => {
    const indexed = new Set(
      indexRows.map((row) => row.href.replace(/^\.\//, '')),
    );
    for (const name of numberPrefixed) {
      assert.ok(
        indexed.has(name),
        `adr/${name} is not listed in adr/README.md`,
      );
    }
  },
);
