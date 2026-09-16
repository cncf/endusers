import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-architectures.mjs';

const validRecord = {
  id: 'acme-platform',
  title: 'Acme Platform',
  organization: 'Acme Corp',
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
