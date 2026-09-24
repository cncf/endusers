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

// `sourceUrl` is the provenance link rendered by `SyncStatus` in
// src/components/RadarReports/index.js, under the hard-coded anchor text
// "cncf.io/reports" — its real destination is never shown to the reader. An
// absent value renders `href="undefined"`, an http:// value downgrades an
// outbound link to plaintext, and an off-host or userinfo-disguised value
// publishes an attacker-controlled link under CNCF branding, so every term of
// the guard is asserted rather than just its presence.
test('rejects a missing sourceUrl', () => {
  const { sourceUrl, ...withoutSourceUrl } = validData;
  const result = runScriptWithFixtures(SCRIPT, fixture(withoutSourceUrl));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a non-https sourceUrl', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      sourceUrl: 'http://www.cncf.io/reports',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects an off-host sourceUrl', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: 'https://evil.example/reports' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

// A suffix match on the bare string would accept this; the guard compares the
// parsed hostname against the allow-list instead.
test('rejects a sourceUrl whose host merely ends in the allowed name', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: 'https://www.cncf.io.evil.example/x' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects a sourceUrl whose userinfo disguises the real host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: 'https://www.cncf.io@evil.example/x' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
});

test('rejects an unparseable sourceUrl without crashing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: 'https://' }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('rejects a non-string sourceUrl without crashing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, sourceUrl: ['https://www.cncf.io/reports'] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sourceUrl must be an https URL/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('rejects an empty radarReports array', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

// The array guard is a two-term disjunction: the empty-array test above only
// reaches the `!length` term. A null value — what a collector writes when an
// upstream fetch yields nothing — takes the `!Array.isArray` term instead.
test('rejects a null radarReports value', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: null }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
});

test('rejects a truthy non-array radarReports without crashing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: { 1: validEntry } }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /non-empty array/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('rejects duplicate ids', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [validEntry, validEntry] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate or missing id/);
});

// The duplicate case above always supplies an id, so the `entry.id ??
// entry.slug ?? 'unknown'` label fallback is only reached by an entry that
// omits it. The label is what a maintainer reads to find the offending record.
test('labels an id-less entry by its slug', () => {
  const { id, ...withoutId } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [withoutId] }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /example-radar-report: duplicate or missing id/,
    'an id-less entry should be reported against its slug',
  );
});

test('labels an entry with neither id nor slug as unknown', () => {
  const { id, slug, ...anonymous } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [anonymous] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown: duplicate or missing id/);
});

test('rejects an entry missing a title', () => {
  const { title, ...withoutTitle } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [withoutTitle] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing title/);
});

// Each entry url becomes a `target="_blank"` card link on /reports, published
// under a CNCF-vetted heading. A missing value renders `href="undefined"`, an
// http:// value ships a plaintext outbound link, and an off-host or
// userinfo-disguised value sends the visitor to an attacker. The guard covers
// all of them, so all of them are asserted.
test('rejects an entry missing a url', () => {
  const { url, ...withoutUrl } = validEntry;
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({ ...validData, radarReports: [withoutUrl] }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('rejects an entry whose url is not https', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [
        { ...validEntry, url: 'http://www.cncf.io/reports/example/' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('rejects an entry url on an unrelated host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [{ ...validEntry, url: 'https://evil.example/report/' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

test('rejects an entry url whose userinfo disguises the real host', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [
        { ...validEntry, url: 'https://www.cncf.io@evil.example/report.pdf' },
      ],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
});

// The rejection message quotes the offending value so a maintainer reading CI
// output can see the real destination rather than just the field name.
test('names the rejected entry url in the error message', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [{ ...validEntry, url: 'https://evil.example/report/' }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"https:\/\/evil\.example\/report\/"/);
});

test('rejects a non-string entry url without crashing', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [{ ...validEntry, url: { href: 'https://www.cncf.io/' } }],
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /url must be an https URL/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

// The allow-list is a suffix match on the parsed hostname, so a legitimate
// bare-apex or subdomain report link must still pass.
test('accepts a report url on a cncf.io subdomain', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    fixture({
      ...validData,
      radarReports: [{ ...validEntry, url: 'https://cncf.io/reports/x/' }],
    }),
  );
  assert.equal(result.status, 0, result.stderr);
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
