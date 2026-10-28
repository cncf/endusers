import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRepoRoot } from './helpers.mjs';
import { parse as parseYaml } from 'yaml';
import { REPO_AUTHORED_PAGES } from '../scripts/lib/architecture-pages.mjs';
import {
  catalogRecords,
  collectArchitectureRecords,
} from '../scripts/lib/architecture-frontmatter.mjs';

// Each docs/architectures/<id>/index.md carries its catalog metadata in front
// matter, and data/architectures/catalog.json is generated from those pages
// (scripts/generate-architectures.mjs). validate-architectures.mjs gates the
// committed catalog against the pages; these tests pin the shape of what the
// pages describe, so a page edit that passes the validator still cannot drop
// a field the site renders.

const repoRoot = resolveRepoRoot(import.meta.url);
const catalogPath = join(repoRoot, 'data/architectures/catalog.json');
const docsDir = join(repoRoot, 'docs/architectures');

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

// Three provenance shapes coexist in the catalog. Records that originated in
// the CNCF Cloud Native Reference Architecture project are pinned to the
// cncf/architecture commit they were taken from (`sourceCommit` + a
// commit-pinned `sourceUrl`), which is what their CC BY 4.0 attribution
// cites. scripts/import-architecture-issue.mjs turns a submission issue into
// a record whose source IS the issue (`sourceIssue` + the issue URL). A page
// authored directly in this repository from some other source carries neither
// and cites only its `sourceUrl`, so each pinning assertion below applies only
// to records that carry its field.
function isIssueSourced(record) {
  return typeof record?.sourceIssue === 'number';
}

function isCommitSourced(record) {
  return typeof record?.sourceCommit === 'string';
}

const REQUIRED_STRING_FIELDS = [
  'id',
  'title',
  'organization',
  'summary',
  'sourceUrl',
  'published',
  'updated',
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
  return join(docsDir, id, 'index.md');
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
    if (!isCommitSourced(record)) continue;
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

test('issue-submitted records cite the submission issue as their source', () => {
  for (const record of catalog) {
    if (!isIssueSourced(record)) continue;
    assert.ok(
      Number.isInteger(record.sourceIssue) && record.sourceIssue > 0,
      `${record.id}: sourceIssue must be a positive issue number`,
    );
    assert.equal(
      record.sourceUrl,
      `https://github.com/cncf/endusers/issues/${record.sourceIssue}`,
      `${record.id}: issue-submitted record sourceUrl must be its submission issue`,
    );
  }
});

test("catalog.json is exactly what the pages' front matter generates", () => {
  const { records, problems, irregular } = collectArchitectureRecords(
    docsDir,
    REPO_AUTHORED_PAGES,
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(irregular, []);
  assert.deepEqual(
    catalog,
    catalogRecords(records),
    'catalog.json has drifted from the pages; run `npm run generate:architectures`',
  );
});

test('catalog ids and generated doc pages are one-to-one', () => {
  const pages = readdirSync(docsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(docsDir, entry.name, 'index.md')),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    pages,
    catalog.map((record) => record.id).sort(),
    'every catalog id needs a docs/architectures/<id>/index.md and vice versa',
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

test('each doc page attributes the source its record came from', () => {
  for (const record of catalog) {
    const body = readFileSync(docPath(record.id), 'utf8');
    if (isIssueSourced(record)) {
      assert.ok(
        body.includes(`issues/${record.sourceIssue}`),
        `${record.id}: doc page does not cite submission issue #${record.sourceIssue}`,
      );
    } else if (isCommitSourced(record)) {
      assert.ok(
        body.includes(record.sourceCommit),
        `${record.id}: doc page does not cite sourceCommit ${record.sourceCommit}`,
      );
    } else {
      assert.ok(
        body.includes(record.sourceUrl),
        `${record.id}: doc page does not cite sourceUrl ${record.sourceUrl}`,
      );
    }
    assert.match(
      body,
      /creativecommons\.org\/licenses\/by\/4\.0\//,
      `${record.id}: doc page drops the CC BY 4.0 attribution required by the upstream import`,
    );
  }
});

test('every repo-authored architectures page exists and has a title', () => {
  for (const page of REPO_AUTHORED_PAGES) {
    const path = join(docsDir, page);
    assert.ok(existsSync(path), `docs/architectures/${page} must exist`);
    const frontmatter = readFrontmatter(readFileSync(path, 'utf8'), page);
    assert.equal(typeof frontmatter.title, 'string', page);
  }
});

test('assets are namespaced under the record id and present in its images/', () => {
  for (const record of catalog) {
    for (const asset of record.assets) {
      const prefix = `/img/architectures/${record.id}/`;
      assert.ok(
        asset.startsWith(prefix),
        `${record.id}: asset ${asset} is not namespaced under ${prefix}`,
      );
      assert.ok(
        existsSync(
          join(docsDir, record.id, 'images', asset.slice(prefix.length)),
        ),
        `${record.id}: asset ${asset} is missing from docs/architectures/${record.id}/images/`,
      );
    }
  }
});

test('docs/architectures holds no directory without a record', () => {
  const ids = new Set(catalog.map((record) => record.id));
  const orphans = readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !ids.has(entry.name))
    .map((entry) => entry.name);
  assert.deepEqual(
    orphans,
    [],
    'architecture directories remain for architectures no longer in the catalog',
  );
});
