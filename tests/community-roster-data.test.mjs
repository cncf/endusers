import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Contract test for the checked-in roster file, not for the script that reads
// it. scripts/fetch-community-people.mjs derives every published profile from
// this data and has no validator; its failure modes are silent, so these
// assertions are the only guard on the source of truth itself.
const DATA_PATH = fileURLToPath(
  new URL('../data/community-roster.json', import.meta.url),
);

// The exact field set destructured by fetch-community-people.mjs.
const KNOWN_FIELDS = [
  'name',
  'company',
  'role',
  'github',
  'linkedin',
  'twitter',
];
const REQUIRED_STRING_FIELDS = ['name', 'company'];
const NULLABLE_STRING_FIELDS = ['role', 'github', 'linkedin', 'twitter'];

// GitHub usernames: alphanumeric, single internal hyphens, 1-39 characters.
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

const raw = readFileSync(DATA_PATH, 'utf8');

test('data/community-roster.json parses as JSON', () => {
  assert.doesNotThrow(() => JSON.parse(raw));
});

const roster = JSON.parse(raw);

function allEntries() {
  return Object.entries(roster.sections).flatMap(([section, entries]) =>
    entries.map((entry, index) => ({ section, index, entry })),
  );
}

function describeEntry({ section, index, entry }) {
  const label =
    typeof entry?.name === 'string' && entry.name ? entry.name : `#${index}`;
  return `${section} entry ${label}`;
}

test('exposes sections and fallbackImages as objects', () => {
  assert.equal(
    Object.prototype.toString.call(roster.sections),
    '[object Object]',
  );
  assert.equal(
    Object.prototype.toString.call(roster.fallbackImages),
    '[object Object]',
  );
});

test('every section is a non-empty array of plain objects', () => {
  const sections = Object.entries(roster.sections);
  assert.ok(sections.length > 0, 'expected at least one section');
  for (const [section, entries] of sections) {
    assert.ok(Array.isArray(entries), `section ${section} is not an array`);
    assert.ok(entries.length > 0, `section ${section} is empty`);
    entries.forEach((entry, index) => {
      assert.equal(
        Object.prototype.toString.call(entry),
        '[object Object]',
        `section ${section} entry #${index} is not an object`,
      );
    });
  }
});

test('every entry has a non-empty name and company', () => {
  for (const record of allEntries()) {
    for (const field of REQUIRED_STRING_FIELDS) {
      const value = record.entry[field];
      assert.equal(
        typeof value,
        'string',
        `${describeEntry(record)} has a non-string ${field}`,
      );
      assert.notEqual(
        value.trim(),
        '',
        `${describeEntry(record)} has an empty ${field}`,
      );
    }
  }
});

test('optional fields are a non-empty string or explicitly null', () => {
  for (const record of allEntries()) {
    for (const field of NULLABLE_STRING_FIELDS) {
      if (!(field in record.entry)) continue;
      const value = record.entry[field];
      if (value === null) continue;
      assert.equal(
        typeof value,
        'string',
        `${describeEntry(record)} has ${field} set to neither a string nor null`,
      );
      assert.notEqual(
        value.trim(),
        '',
        `${describeEntry(record)} has an empty ${field}; use null instead`,
      );
    }
  }
});

test('no entry carries fields the script does not read', () => {
  for (const record of allEntries()) {
    const unexpected = Object.keys(record.entry).filter(
      (key) => !KNOWN_FIELDS.includes(key),
    );
    assert.deepEqual(
      unexpected,
      [],
      `${describeEntry(record)} has unrecognised field(s): ${unexpected.join(', ')}`,
    );
  }
});

test('names are unique across all sections because fallbackImages is keyed by name', () => {
  const seen = new Set();
  const duplicates = [];
  for (const { entry } of allEntries()) {
    if (seen.has(entry.name)) duplicates.push(entry.name);
    seen.add(entry.name);
  }
  assert.deepEqual(
    duplicates,
    [],
    `duplicate roster name(s): ${duplicates.join(', ')}`,
  );
});

test('github handles are unique so previous-run lookups stay unambiguous', () => {
  const seen = new Set();
  const duplicates = [];
  for (const { entry } of allEntries()) {
    if (!entry.github) continue;
    if (seen.has(entry.github)) duplicates.push(entry.github);
    seen.add(entry.github);
  }
  assert.deepEqual(
    duplicates,
    [],
    `duplicate github handle(s): ${duplicates.join(', ')}`,
  );
});

test('github handles match GitHub username grammar', () => {
  for (const record of allEntries()) {
    const handle = record.entry.github;
    if (!handle) continue;
    assert.match(
      handle,
      GITHUB_HANDLE,
      `${describeEntry(record)} has an invalid github handle: ${handle}`,
    );
  }
});

test('every entry resolves to an image via a github handle or a fallback', () => {
  for (const record of allEntries()) {
    const hasImage =
      Boolean(record.entry.github) ||
      Object.prototype.hasOwnProperty.call(
        roster.fallbackImages,
        record.entry.name,
      );
    assert.ok(
      hasImage,
      `${describeEntry(record)} has no github handle and no fallbackImages entry, so it would publish an empty image`,
    );
  }
});

test('every fallbackImages key matches a roster name', () => {
  const names = new Set(allEntries().map(({ entry }) => entry.name));
  const orphans = Object.keys(roster.fallbackImages).filter(
    (key) => !names.has(key),
  );
  assert.deepEqual(
    orphans,
    [],
    `fallbackImages key(s) matching no roster name: ${orphans.join(', ')}`,
  );
});

test('every fallbackImages value is an absolute https URL', () => {
  for (const [name, url] of Object.entries(roster.fallbackImages)) {
    assert.equal(
      typeof url,
      'string',
      `fallbackImages.${name} is not a string`,
    );
    let parsed;
    assert.doesNotThrow(() => {
      parsed = new URL(url);
    }, `fallbackImages.${name} is an unparseable url: ${url}`);
    assert.equal(
      parsed.protocol,
      'https:',
      `fallbackImages.${name} uses ${parsed.protocol} rather than https:`,
    );
  }
});

test('no string field carries leading or trailing whitespace', () => {
  for (const record of allEntries()) {
    for (const field of KNOWN_FIELDS) {
      const value = record.entry[field];
      if (typeof value !== 'string') continue;
      assert.equal(
        value,
        value.trim(),
        `${describeEntry(record)} has padded whitespace in ${field}`,
      );
    }
  }
});

test('the file is formatted with a trailing newline', () => {
  assert.ok(raw.endsWith('\n'), 'expected a trailing newline');
});
