import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Contract test for the checked-in data file, not for a script. The corpus is
// rendered directly by src/components/ProjectsBorn/index.js and has no
// validate-*.mjs of its own, so these assertions are the only guard on it.
const DATA_PATH = fileURLToPath(
  new URL('../data/projects-born.json', import.meta.url),
);

const REQUIRED_FIELDS = ['name', 'origin', 'description', 'url'];

const raw = readFileSync(DATA_PATH, 'utf8');

function describeEntry(entry, index) {
  const label =
    typeof entry?.name === 'string' && entry.name ? entry.name : `#${index}`;
  return `entry ${label}`;
}

test('data/projects-born.json parses as JSON', () => {
  assert.doesNotThrow(() => JSON.parse(raw));
});

const projects = JSON.parse(raw);

test('is a non-empty array', () => {
  assert.ok(Array.isArray(projects), 'expected the top level to be an array');
  assert.ok(projects.length > 0, 'expected at least one project');
});

test('every entry is a plain object', () => {
  projects.forEach((entry, index) => {
    assert.equal(
      Object.prototype.toString.call(entry),
      '[object Object]',
      `${describeEntry(entry, index)} is not an object`,
    );
  });
});

test('every entry has all required fields as non-empty strings', () => {
  projects.forEach((entry, index) => {
    for (const field of REQUIRED_FIELDS) {
      const value = entry[field];
      assert.equal(
        typeof value,
        'string',
        `${describeEntry(entry, index)} has a non-string ${field}`,
      );
      assert.notEqual(
        value.trim(),
        '',
        `${describeEntry(entry, index)} has an empty ${field}`,
      );
    }
  });
});

test('no entry carries fields the component does not render', () => {
  projects.forEach((entry, index) => {
    const unexpected = Object.keys(entry).filter(
      (key) => !REQUIRED_FIELDS.includes(key),
    );
    assert.deepEqual(
      unexpected,
      [],
      `${describeEntry(entry, index)} has unrecognised field(s): ${unexpected.join(', ')}`,
    );
  });
});

test('name values are unique because name is the React list key', () => {
  const seen = new Map();
  const duplicates = [];
  projects.forEach((entry) => {
    if (seen.has(entry.name)) duplicates.push(entry.name);
    seen.set(entry.name, true);
  });
  assert.deepEqual(
    duplicates,
    [],
    `duplicate project name(s): ${duplicates.join(', ')}`,
  );
});

test('every url is an absolute https URL', () => {
  projects.forEach((entry, index) => {
    let parsed;
    assert.doesNotThrow(
      () => {
        parsed = new URL(entry.url);
      },
      `${describeEntry(entry, index)} has an unparseable url: ${entry.url}`,
    );
    assert.equal(
      parsed.protocol,
      'https:',
      `${describeEntry(entry, index)} uses ${parsed.protocol} rather than https:`,
    );
    assert.notEqual(
      parsed.hostname,
      '',
      `${describeEntry(entry, index)} has a url with no host`,
    );
  });
});

test('no field carries leading or trailing whitespace', () => {
  projects.forEach((entry, index) => {
    for (const field of REQUIRED_FIELDS) {
      assert.equal(
        entry[field],
        entry[field].trim(),
        `${describeEntry(entry, index)} has padded whitespace in ${field}`,
      );
    }
  });
});

test('the file is formatted with a trailing newline', () => {
  assert.ok(raw.endsWith('\n'), 'expected a trailing newline');
});
