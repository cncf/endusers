import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-architectures.mjs';

const validRecord = {
  id: 'acme-platform',
  title: 'Acme Platform',
  organization: 'Acme Corp',
  sourceUrl: 'https://github.com/cncf/architecture/blob/main/acme-platform.md',
  assets: ['/img/architectures/acme-platform/diagram.svg'],
};

function catalogFixture(records, extraFiles = {}) {
  return {
    'data/architectures/catalog.json': JSON.stringify(records),
    'static/img/architectures/acme-platform/diagram.svg': '<svg/>',
    ...extraFiles,
  };
}

test('accepts a valid catalog', () => {
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([validRecord]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 architecture records/);
});

test('rejects records missing id, title, or organization', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([{ id: 'incomplete' }]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing id, title, or organization/);
});

test('rejects duplicate ids', () => {
  const dupe = { ...validRecord };
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([validRecord, dupe]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate id/);
});

test('rejects a record whose sourceUrl is absent', () => {
  const { sourceUrl, ...noSource } = validRecord;
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([noSource]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a non-https sourceUrl', () => {
  const record = { ...validRecord, sourceUrl: 'http://example.com/a' };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a javascript: sourceUrl', () => {
  const record = { ...validRecord, sourceUrl: 'javascript:alert(1)' };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a sourceUrl that is not a parseable URL', () => {
  const record = { ...validRecord, sourceUrl: 'not a url' };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a sourceUrl that is not a string', () => {
  const record = { ...validRecord, sourceUrl: 42 };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects an id that is not a lowercase slug', () => {
  const record = { ...validRecord, id: 'Acme_Platform' };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id must be a lowercase slug/);
});

test('rejects an asset outside the architectures prefix', () => {
  const record = { ...validRecord, assets: ['/img/logos/acme.svg'] };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a site-absolute path contained in/);
});

test('rejects an asset that escapes the architectures prefix with ..', () => {
  const record = {
    ...validRecord,
    assets: ['/img/architectures/../../../etc/passwd'],
  };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a site-absolute path contained in/);
});

test('rejects an asset that is not a string', () => {
  const record = { ...validRecord, assets: [42] };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a site-absolute path contained in/);
});

test('rejects assets missing from static/', () => {
  const fixtures = {
    'data/architectures/catalog.json': JSON.stringify([validRecord]),
  };
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing asset/);
});

test('accepts records without an assets array', () => {
  const { assets, ...noAssets } = validRecord;
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([noAssets]));
  assert.equal(result.status, 0, result.stderr);
});

test('fails when catalog.json is absent', () => {
  const result = runScriptWithFixtures(SCRIPT, {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing data\/architectures\/catalog\.json/);
});

test('rejects active content in an imported architecture page', () => {
  const fixtures = catalogFixture([validRecord], {
    'docs/architectures/acme-platform.md':
      '# Acme\n\n<script>fetch("https://evil.test")</script>\n',
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /acme-platform\.md:3/);
  assert.match(result.stderr, /active content in imported page/);
});

test('accepts an imported architecture page with only inert content', () => {
  const fixtures = catalogFixture([validRecord], {
    'docs/architectures/acme-platform.md': [
      "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';",
      '',
      '# Acme',
      '',
      '<CNCFProjectCard name="Kubernetes" href="https://www.cncf.io/projects/kubernetes/" />',
      '',
    ].join('\n'),
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 0, result.stderr);
});

// A userinfo component makes the visible prefix and the real host disagree:
// "https://www.cncf.io@evil.example/x" reads as CNCF in a generated diff and
// resolves to evil.example in a browser. sourceUrl is rendered as an href in
// the member directory, so the gate must reject it rather than admit it on the
// strength of the https scheme alone.
test('rejects a sourceUrl carrying a userinfo component', () => {
  const record = {
    ...validRecord,
    sourceUrl: 'https://www.cncf.io@evil.example/acme-platform.md',
  };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a sourceUrl carrying a password-only userinfo component', () => {
  const record = {
    ...validRecord,
    sourceUrl: 'https://:token@evil.example/acme-platform.md',
  };
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([record]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

// record.id doubles as the error label, so a record that is missing it falls
// back to '<unknown>'. Line coverage cannot see that fallback: the rest of
// each `path: record.id || '<unknown>'` line runs on every malformed record.
// Both fallback sites fire for one id-less record, and the reported label is
// what a maintainer reads to find the offending entry.
test('labels an id-less record <unknown> in every error it raises', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([{ title: 'Acme Platform', organization: 'Acme Corp' }]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] <unknown>: missing id, title, or organization/,
  );
  assert.match(
    result.stderr,
    /\[error\] <unknown>: sourceUrl must be an https URL/,
  );
  assert.doesNotMatch(result.stderr, /\[error\] undefined:/);
});

// Docusaurus routes docs/ by filesystem, so a page the catalog does not name
// is published anyway. Scanning per catalog record left exactly those pages
// unguarded; the scan is driven by the directory instead.
test('rejects a published page that has no catalog record', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([validRecord], {
      'docs/architectures/acme-platform.md': '# Acme\n',
      'docs/architectures/orphan.md': '# Orphan\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] orphan\.md: page has no catalog record/,
  );
});

test('scans a catalog-less page for active content instead of skipping it', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([validRecord], {
      'docs/architectures/orphan.md':
        '# Orphan\n\n<iframe src="https://evil.example"></iframe>\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /orphan\.md:3: active content in imported page \(disallowed element <iframe>\)/,
  );
});

// An MDX expression is evaluated JavaScript, so an unscanned page runs code in
// the build job that holds the Pages deploy credential.
test('scans a catalog-less page for MDX expressions', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([validRecord], {
      'docs/architectures/orphan.md': '# Orphan\n\nvalue: {String(1)}\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /orphan\.md:3: active content in imported page \(MDX expression\)/,
  );
});

// index.md is hand-authored, not imported: it renders layout elements and
// imports a component, all of which the imported-content gate is right to
// reject in an imported body. Scanning it would turn CI red on repo content.
test('exempts the hand-authored index page from the imported-content gate', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([validRecord], {
      'docs/architectures/index.md':
        '# Catalog\n\n<div className="pillars"><h3>Why</h3></div>\n\nimport X from \'@site/src/components/X\';\n\n<X />\n',
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 architecture records/);
});

// A nested page is published at its own route and can never match a catalog
// id, so it is reported rather than silently walked past.
test('rejects a nested page under docs/architectures', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    catalogFixture([validRecord], {
      'docs/architectures/reports/leftover.md': '# Leftover\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] reports\/leftover\.md: page has no catalog record/,
  );
});

// Dirent.isFile() is false for a symlink, so a symlinked page would be walked
// past and published unread if it were merely skipped.
test('rejects a symlinked page rather than skipping it', () => {
  const result = runScriptWithFixtures(SCRIPT, catalogFixture([validRecord]), {
    symlinks: { 'docs/architectures/linked.md': '/etc/hostname' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /linked\.md: page must be a regular file/);
});
