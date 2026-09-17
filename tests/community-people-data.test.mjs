import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;

const people = JSON.parse(
  readFileSync(join(repoRoot, 'data/community-people.json'), 'utf8'),
);
const roster = JSON.parse(
  readFileSync(join(repoRoot, 'data/community-roster.json'), 'utf8'),
);

// src/components/CommunityPeople interpolates these values into
// `https://github.com/${value}`, `https://www.linkedin.com/in/${value}` and
// `https://twitter.com/${value}` without escaping. Anything outside this
// pattern -- a slash, a query string, a fragment, `..` -- would send the link
// somewhere other than the profile it claims to point at.
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function eachPerson() {
  return Object.entries(people.people).flatMap(([section, entries]) =>
    entries.map((person) => [section, person]),
  );
}

// The sections the site actually renders, read out of the docs rather than
// hard-coded, so adding a <CommunityPeople section="..." /> automatically
// brings that section under this contract.
function sectionsReferencedByDocs() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.mdx?$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8');
        if (!source.includes('CommunityPeople')) continue;
        for (const match of source.matchAll(
          /<CommunityPeople[^>]*\bsection=["']([^"']+)["']/g,
        )) {
          found.add(match[1]);
        }
      }
    }
  };
  walk(join(repoRoot, 'docs'));
  return [...found];
}

test('fetchedAt records a parseable refresh time', () => {
  assert.equal(typeof people.fetchedAt, 'string');
  assert.ok(
    !Number.isNaN(Date.parse(people.fetchedAt)),
    `fetchedAt is not a parseable date: ${people.fetchedAt}`,
  );
});

test('people is a plain object of sections', () => {
  assert.ok(people.people && typeof people.people === 'object');
  assert.ok(!Array.isArray(people.people));
  for (const [section, entries] of Object.entries(people.people)) {
    assert.ok(Array.isArray(entries), `section ${section} is not an array`);
  }
});

test('sections match the roster the generator reads from', () => {
  assert.deepEqual(
    Object.keys(people.people).sort(),
    Object.keys(roster.sections).sort(),
  );
});

test('every section has an entry for each rostered person', () => {
  for (const [section, entries] of Object.entries(roster.sections)) {
    assert.equal(
      people.people[section].length,
      entries.length,
      `section ${section} has ${people.people[section].length} generated entries for ${entries.length} rostered people`,
    );
  }
});

test('docs reference at least one section', () => {
  assert.ok(
    sectionsReferencedByDocs().length > 0,
    'no <CommunityPeople section="..." /> found under docs/ -- update this test if the component moved',
  );
});

test('every section rendered by the docs exists and is non-empty', () => {
  for (const section of sectionsReferencedByDocs()) {
    const entries = people.people[section];
    assert.ok(
      Array.isArray(entries),
      `docs render section "${section}", which data/community-people.json does not define`,
    );
    assert.ok(
      entries.length > 0,
      `docs render section "${section}", which is empty -- the page would show no people`,
    );
  }
});

test('names are non-empty and unique within their section', () => {
  for (const [section, entries] of Object.entries(people.people)) {
    const names = entries.map((person) => person.name);
    for (const name of names) {
      assert.equal(typeof name, 'string');
      assert.notEqual(name.trim(), '', `empty name in section ${section}`);
    }
    assert.equal(
      new Set(names).size,
      names.length,
      `duplicate name in section ${section}; the component keys cards by name`,
    );
  }
});

test('every person has an https image to render', () => {
  for (const [section, person] of eachPerson()) {
    assert.match(
      person.image ?? '',
      /^https:\/\/\S+$/,
      `${section}/${person.name} has no https image: ${JSON.stringify(person.image)}`,
    );
  }
});

test('optional text fields are strings, never null or undefined', () => {
  for (const [section, person] of eachPerson()) {
    for (const field of ['bio', 'location', 'blog']) {
      assert.equal(
        typeof person[field],
        'string',
        `${section}/${person.name}.${field} is ${JSON.stringify(person[field])}`,
      );
    }
  }
});

test('nullable fields are a string or null, never undefined', () => {
  for (const [section, person] of eachPerson()) {
    for (const field of ['role', 'linkedin', 'twitter', 'profileUpdatedAt']) {
      assert.ok(
        person[field] === null || typeof person[field] === 'string',
        `${section}/${person.name}.${field} is ${JSON.stringify(person[field])}`,
      );
    }
  }
});

test('profileUpdatedAt is parseable when present', () => {
  for (const [section, person] of eachPerson()) {
    if (!person.profileUpdatedAt) continue;
    assert.ok(
      !Number.isNaN(Date.parse(person.profileUpdatedAt)),
      `${section}/${person.name} has an unparseable profileUpdatedAt: ${person.profileUpdatedAt}`,
    );
  }
});

test('repo and follower counts are non-negative integers', () => {
  for (const [section, person] of eachPerson()) {
    for (const field of ['publicRepos', 'followers']) {
      assert.ok(
        Number.isInteger(person[field]) && person[field] >= 0,
        `${section}/${person.name}.${field} is ${JSON.stringify(person[field])}`,
      );
    }
  }
});

test('social handles cannot redirect the links built from them', () => {
  for (const [section, person] of eachPerson()) {
    for (const field of ['github', 'linkedin', 'twitter']) {
      const value = person[field];
      if (!value) continue;
      assert.match(
        value,
        HANDLE,
        `${section}/${person.name}.${field} is not a bare handle: ${JSON.stringify(value)}`,
      );
    }
  }
});

test('blog normalises to an http(s) URL under the component rule', () => {
  for (const [section, person] of eachPerson()) {
    const { blog } = person;
    if (!blog) continue;
    const href = blog.startsWith('http') ? blog : `https://${blog}`;
    let url;
    assert.doesNotThrow(
      () => {
        url = new URL(href);
      },
      `${section}/${person.name} has a blog that does not form a URL: ${JSON.stringify(blog)}`,
    );
    assert.ok(
      ['http:', 'https:'].includes(url.protocol),
      `${section}/${person.name} has a blog with protocol ${url.protocol}: ${JSON.stringify(blog)}`,
    );
    assert.notEqual(
      url.hostname,
      '',
      `${section}/${person.name} has a blog with no host: ${JSON.stringify(blog)}`,
    );
  }
});
