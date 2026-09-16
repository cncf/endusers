import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-radar-reports.mjs';

const validEntry = {
  id: 1,
  title: 'Example Radar Report',
  slug: 'example-radar-report',
  url: 'https://www.cncf.io/reports/example-radar-report/',
  publishedAt: '2024-01-01',
  summary: 'A brief, real description of the report.',
};

const validData = {
  generatedAt: '2026-08-07T00:00:00.000Z',
  sourceUrl: 'https://www.cncf.io/reports?_sft_lf-report-type=radar',
  radarReports: [validEntry],
};

function fixture(data) {
  return { 'data/radar-reports.json': JSON.stringify(data) };
}

test('accepts a minimal valid radar reports file', () => {
  const result = runScriptWithFixtures(SCRIPT, fixture(validData));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 radar reports/);
});

test('rejects a non-parseable generatedAt', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, generatedAt: 'nope' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generatedAt must be a parseable date/);
});

test('rejects an empty radarReports array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

test('rejects duplicate ids', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [validEntry, validEntry] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing id/);
});

test('rejects an entry missing a summary', () => {
  const { summary, ...withoutSummary } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [withoutSummary] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing summary/);
});

test('warns (but does not fail) on a placeholder summary', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [
        {
          ...validEntry,
          summary: 'Summary needed — see the report for details.',
        },
      ],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /still the auto-generated placeholder/);
});
