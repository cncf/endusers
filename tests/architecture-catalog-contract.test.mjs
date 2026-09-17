import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// The architecture catalog, the per-record JSON files and the generated
// Docusaurus pages are three artifacts written by a single import run
// (scripts/import-architectures.mjs). Nothing re-checks that they still agree
// once committed: validate-architectures.mjs reads only catalog.json, and
// validate-architecture-assets.mjs reads only static/img/architectures. A
// partial import, a hand-edited page or a deleted record therefore ships a
// catalog entry with no page, or a page with no entry, without failing a
// check. These tests assert the contract between the three.

const repoRoot = new URL('..', import.meta.url).pathname;
const catalogPath = join(repoRoot, 'data/architectures/catalog.json');
const recordsDir = join(repoRoot, 'data/architectures/records');
const docsDir = join(repoRoot, 'docs/architectures');
const assetsRoot = join(repoRoot, 'static/img/architectures');

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

const REQUIRED_STRING_FIELDS = [
  'id',
  'title',
  'organization',
  'summary',
  'sourceUrl',
  'sourceCommit',
];
const REQUIRED_ARRAY_FIELDS = ['industries', 'tags', 'projects', 'assets'];

function readFrontmatter(markdown, label) {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  assert.ok(match, `${label}: no YAML frontmatter block`);
  const parsed = parseYaml(match[1]);
  assert.ok(
    parsed && typeof parsed === 'object',
    `${label}: frontmatter is not a mapping`,
  );
  return parsed;
}

function docPath(id) {
  return join(docsDir, `${id}.md`);
}

test('catalog.json is a non-empty array of uniquely identified records', () => {
  assert.ok(Array.isArray(catalog), 'catalog.json must hold an array');
  assert.ok(catalog.length > 0, 'catalog.json must not be empty');

  const seen = new Set();
  for (const record of catalog) {
    assert.match(
      record.id ?? '',
      /^[a-z0-9][a-z0-9-]*$/,
      `catalog id ${JSON.stringify(record.id)} is not a lowercase slug`,
    );
    assert.ok(!seen.has(record.id), `duplicate catalog id ${record.id}`);
    seen.add(record.id);
  }
});

test('every catalog record carries the fields the site renders', () => {
  for (const record of catalog) {
    for (const field of REQUIRED_STRING_FIELDS) {
      assert.equal(
        typeof record[field],
        'string',
        `${record.id}: ${field} must be a string`,
      );
      assert.notEqual(
        record[field].trim(),
        '',
        `${record.id}: ${field} must not be empty`,
      );
    }
    for (const field of REQUIRED_ARRAY_FIELDS) {
      assert.ok(
        Array.isArray(record[field]),
        `${record.id}: ${field} must be an array`,
      );
      for (const value of record[field]) {
        assert.equal(
          typeof value,
          'string',
          `${record.id}: ${field} must contain only strings`,
        );
        assert.notEqual(
          value.trim(),
          '',
          `${record.id}: ${field} must not contain empty strings`,
        );
      }
    }
  }
});

test('provenance pins an upstream commit that the source URL points at', () => {
  for (const record of catalog) {
    assert.match(
      record.sourceCommit,
      /^[0-9a-f]{40}$/,
      `${record.id}: sourceCommit must be a full 40-character SHA`,
    );
    assert.ok(
      record.sourceUrl.startsWith('https://github.com/cncf/architecture/'),
      `${record.id}: sourceUrl must point at cncf/architecture, got ${record.sourceUrl}`,
    );
    assert.ok(
      record.sourceUrl.includes(record.sourceCommit),
      `${record.id}: sourceUrl must be pinned to sourceCommit`,
    );
  }
});

test('catalog and data/architectures/records are one-to-one', () => {
  const recordFiles = readdirSync(recordsDir).filter((name) =>
    name.endsWith('.json'),
  );
  const fromFiles = recordFiles
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
  const fromCatalog = catalog.map((record) => record.id).sort();
  assert.deepEqual(
    fromFiles,
    fromCatalog,
    'every catalog id needs a records/<id>.json and vice versa',
  );
});

test('each record file is byte-identical in content to its catalog entry', () => {
  for (const record of catalog) {
    const onDisk = JSON.parse(
      readFileSync(join(recordsDir, `${record.id}.json`), 'utf8'),
    );
    assert.deepEqual(
      onDisk,
      record,
      `${record.id}: records/${record.id}.json has drifted from catalog.json`,
    );
  }
});

test('catalog ids and generated doc pages are one-to-one', () => {
  const pages = readdirSync(docsDir)
    .filter((name) => name.endsWith('.md') && name !== 'index.md')
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
  assert.deepEqual(
    pages,
    catalog.map((record) => record.id).sort(),
    'every catalog id needs a docs/architectures/<id>.md and vice versa',
  );
});

test('doc frontmatter reuses the record title and labels the sidebar', () => {
  for (const record of catalog) {
    const file = docPath(record.id);
    assert.ok(existsSync(file), `${record.id}: missing docs page`);
    const frontmatter = readFrontmatter(
      readFileSync(file, 'utf8'),
      `${record.id}.md`,
    );
    assert.equal(
      frontmatter.title,
      record.title,
      `${record.id}: doc title differs from the catalog title`,
    );
    assert.equal(
      typeof frontmatter.sidebar_label,
      'string',
      `${record.id}: doc needs a sidebar_label`,
    );
    assert.notEqual(
      frontmatter.sidebar_label.trim(),
      '',
      `${record.id}: sidebar_label must not be empty`,
    );
  }
});

test('each doc page attributes the revision its record was imported from', () => {
  for (const record of catalog) {
    const body = readFileSync(docPath(record.id), 'utf8');
    assert.ok(
      body.includes(record.sourceCommit),
      `${record.id}: doc page does not cite sourceCommit ${record.sourceCommit}`,
    );
    assert.match(
      body,
      /creativecommons\.org\/licenses\/by\/4\.0\//,
      `${record.id}: doc page drops the CC BY 4.0 attribution required by the upstream import`,
    );
  }
});

test('the architectures landing page exists and has a title', () => {
  const index = join(docsDir, 'index.md');
  assert.ok(existsSync(index), 'docs/architectures/index.md must exist');
  const frontmatter = readFrontmatter(readFileSync(index, 'utf8'), 'index.md');
  assert.equal(typeof frontmatter.title, 'string');
});

test('assets are namespaced under the record id and present in static/', () => {
  for (const record of catalog) {
    for (const asset of record.assets) {
      const prefix = `/img/architectures/${record.id}/`;
      assert.ok(
        asset.startsWith(prefix),
        `${record.id}: asset ${asset} is not namespaced under ${prefix}`,
      );
      assert.ok(
        existsSync(join(repoRoot, 'static', asset.slice(1))),
        `${record.id}: asset ${asset} is missing from static/`,
      );
    }
  }
});

test('static/img/architectures holds no directory without a record', () => {
  const ids = new Set(catalog.map((record) => record.id));
  const orphans = readdirSync(assetsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !ids.has(entry.name))
    .map((entry) => entry.name);
  assert.deepEqual(
    orphans,
    [],
    'asset directories remain for architectures no longer in the catalog',
  );
});
