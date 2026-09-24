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
