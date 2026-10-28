import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'generate-architectures.mjs';
const CATALOG = 'data/architectures/catalog.json';

const acmePage = `---
title: Acme Platform
architecture:
  organization: Acme Corp
  summary: Acme runs a platform.
  industries: [Retail]
  tags: [kubernetes]
  projects: [Kubernetes]
  sourceUrl: https://github.com/cncf/architecture/blob/main/acme.md
  sourceCommit: ${'a'.repeat(40)}
  published: 2026-03-01
  updated: 2026-04-15
---

# Acme
`;

const acmeRecord = {
  id: 'acme-platform',
  title: 'Acme Platform',
  organization: 'Acme Corp',
  summary: 'Acme runs a platform.',
  industries: ['Retail'],
  tags: ['kubernetes'],
  projects: ['Kubernetes'],
  sourceUrl: 'https://github.com/cncf/architecture/blob/main/acme.md',
  sourceCommit: 'a'.repeat(40),
  published: '2026-03-01',
  updated: '2026-04-15',
  assets: ['/img/architectures/acme-platform/diagram.svg'],
};

const fixtures = {
  'docs/architectures/index.md': '# Catalog\n',
  'docs/architectures/submit.md': '# Submit\n',
  'docs/architectures/acme-platform/index.md': acmePage,
  'docs/architectures/acme-platform/images/diagram.svg': '<svg/>',
};

test('writes the catalog from the pages when none exists', () => {
  const result = runScriptWithFixtures(SCRIPT, fixtures, {
    readBack: [CATALOG],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote catalog\.json \(1 records\)/);
  assert.equal(
    result.files[CATALOG],
    JSON.stringify([acmeRecord], null, 2) + '\n',
  );
});

// Dates are written unquoted in YAML; the catalog must still carry them as the
// strings the validator's calendar-date rule and the sort comparator expect.
test('keeps unquoted YAML dates as strings', () => {
  const result = runScriptWithFixtures(SCRIPT, fixtures, {
    readBack: [CATALOG],
  });
  const [record] = JSON.parse(result.files[CATALOG]);
  assert.equal(record.published, '2026-03-01');
});

test('rewrites a catalog that is behind the pages', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    { ...fixtures, [CATALOG]: JSON.stringify([{ ...acmeRecord, tags: [] }]) },
    { readBack: [CATALOG] },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote catalog\.json/);
  assert.deepEqual(JSON.parse(result.files[CATALOG]), [acmeRecord]);
});

test('rewrites a catalog that is not valid JSON', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    { ...fixtures, [CATALOG]: '{' },
    { readBack: [CATALOG] },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wrote catalog\.json/);
  assert.deepEqual(JSON.parse(result.files[CATALOG]), [acmeRecord]);
});

// `fix:format` folds short arrays onto one line; that refold is not a reason
// to rewrite the file and churn the diff.
test('leaves a catalog alone that differs only in formatting', () => {
  const formatted = JSON.stringify([acmeRecord], null, 4) + '\n\n';
  const result = runScriptWithFixtures(
    SCRIPT,
    { ...fixtures, [CATALOG]: formatted },
    { readBack: [CATALOG] },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /catalog\.json is current \(1 records\)/);
  assert.equal(result.files[CATALOG], formatted);
});

test('refuses to write when a page cannot yield a record', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    {
      ...fixtures,
      'docs/architectures/orphan.md': '# Orphan\n',
      'docs/architectures/bare/index.md': '# Bare\n',
    },
    { readBack: [CATALOG] },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /generate-architectures: bare\/index\.md: page has no YAML front matter mapping/,
  );
  assert.match(
    result.stderr,
    /generate-architectures: orphan\.md: page is not at <id>\/index\.md/,
  );
  assert.match(result.stderr, /the catalog was not written/);
  assert.equal(result.files[CATALOG], null);
});

test('refuses to write when a page is a symlink', () => {
  const result = runScriptWithFixtures(SCRIPT, fixtures, {
    symlinks: { 'docs/architectures/linked.md': '/etc/hostname' },
    readBack: [CATALOG],
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /generate-architectures: linked\.md: not a regular file or directory/,
  );
  assert.equal(result.files[CATALOG], null);
});

test('surfaces a read failure other than a missing catalog', () => {
  const result = runScriptWithFixtures(SCRIPT, fixtures, {
    setup: (work) => {
      // A directory where the file should be: readFileSync fails with EISDIR.
      mkdirSync(join(work, CATALOG), { recursive: true });
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EISDIR/);
});
