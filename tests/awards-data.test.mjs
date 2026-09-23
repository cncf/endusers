import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// `scripts/validate-awards.mjs` is the only gate on `data/awards.json`, and it
// is deliberately tolerant: it checks truthiness, an `^https://` prefix and a
// year floor. `src/components/AwardsTimeline/index.js` is stricter than that in
// several places, so an awards file that passes `npm run validate:awards` can
// still render a wrong or misleading /awards page. Nothing imports the
// component in a test (there is no JSX transform in `node --test`), so the
// contract is asserted against the component source plus the real data.
const root = fileURLToPath(new URL('..', import.meta.url));
const awards = JSON.parse(readFileSync(join(root, 'data/awards.json'), 'utf8'));
const componentPath = join(root, 'src/components/AwardsTimeline/index.js');
const componentSource = readFileSync(componentPath, 'utf8');

// Fields `WinnerCard` destructures off an entry and renders as bare text.
// A non-string here still passes the validator's truthiness check.
const RENDERED_TEXT_FIELDS = [
  'organization',
  'awardLabel',
  'citation',
  'event',
];
const URL_FIELDS = ['announcementUrl', 'caseStudyUrl', 'talkUrl'];

function entryId(entry, index) {
  return `awards[${index}] (${entry.year}/${entry.slug})`;
}

test('the awards file exposes the top-level keys the timeline reads', () => {
  assert.ok(Array.isArray(awards.awards), 'awards must be an array');
  assert.ok(awards.awards.length > 0, 'awards must not be empty');
  assert.equal(typeof awards.verifiedAt, 'string');
  assert.equal(typeof awards.verifiedAgainst, 'string');
});

// The banner is rendered only when BOTH `verifiedAt` and `verifiedAgainst` are
// present, so dropping either silently removes the audit provenance from the
// page rather than failing anything.
test('verifiedAt is a calendar date that is not in the future', () => {
  assert.match(
    awards.verifiedAt,
    /^\d{4}-\d{2}-\d{2}$/,
    'verifiedAt must be a YYYY-MM-DD calendar date',
  );
  const verified = new Date(awards.verifiedAt);
  assert.ok(
    !Number.isNaN(verified.getTime()),
    `verifiedAt ${awards.verifiedAt} is not a real date`,
  );
  assert.ok(
    verified.getTime() <= Date.now(),
    `verifiedAt ${awards.verifiedAt} is in the future; the page would claim an audit that has not happened`,
  );
});

// AwardsTimeline hard-codes the visible link text for the audit source. The
// validator accepts any https URL, so the href and the label it is rendered
// under can drift apart and the page then misattributes its own provenance.
test('the verifiedAgainst href agrees with the label AwardsTimeline renders', () => {
  const match = componentSource.match(
    /\{awards[Dd]ata\.verifiedAgainst\}[\s\S]*?>\s*([^\s<>{}]+)\s*</,
  );
  assert.ok(
    match,
    `could not find the hard-coded audit-source link text in ${componentPath}`,
  );
  const label = match[1];
  const href = new URL(awards.verifiedAgainst);
  assert.equal(href.protocol, 'https:');
  assert.equal(
    `${href.host}${href.pathname}`.replace(/\/$/, ''),
    label.replace(/\/$/, ''),
    `verifiedAgainst is ${awards.verifiedAgainst} but the page labels that link "${label}"`,
  );
});

test('every rendered text field is a non-empty string', () => {
  awards.awards.forEach((entry, index) => {
    for (const field of RENDERED_TEXT_FIELDS) {
      assert.equal(
        typeof entry[field],
        'string',
        `${entryId(entry, index)}: ${field} must be a string, got ${typeof entry[field]}`,
      );
      assert.ok(
        entry[field].trim().length > 0,
        `${entryId(entry, index)}: ${field} must not be blank`,
      );
    }
  });
});

// `slug` is only ever used as part of a React key, so a non-string or a blank
// value produces a duplicate key rather than a visible failure.
test('every entry carries a kebab-case slug and an integer year', () => {
  awards.awards.forEach((entry, index) => {
    assert.match(
      String(entry.slug),
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      `${entryId(entry, index)}: slug must be kebab-case`,
    );
    assert.ok(
      Number.isInteger(entry.year),
      `${entryId(entry, index)}: year must be an integer`,
    );
  });
});

// The validator resets its sort watermark with `Math.max(entry.year, 2015)`, so
// a single out-of-range year lets a later regression past the ordering check.
// AwardsTimeline re-sorts the year groups but keeps file order inside a group.
test('entries are ordered newest year first', () => {
  const years = awards.awards.map((entry) => entry.year);
  assert.deepEqual(
    years,
    [...years].sort((a, b) => b - a),
    'awards must be sorted newest first so file order matches the rendered order within a year',
  );
});

// Nothing dedupes entries, and the React key is `${slug}-${index}`, so a
// duplicated winner renders twice without any warning.
test('no winner appears twice for the same year', () => {
  const seen = new Set();
  awards.awards.forEach((entry, index) => {
    const key = `${entry.year}/${entry.slug}`;
    assert.ok(!seen.has(key), `${entryId(entry, index)}: duplicate entry`);
    seen.add(key);
  });
});

// The validator's `/^https:\/\//` test accepts the bare string `https://`,
// which is not a URL any browser can resolve.
test('every present link is a resolvable https URL', () => {
  awards.awards.forEach((entry, index) => {
    for (const field of URL_FIELDS) {
      if (entry[field] === undefined || entry[field] === null) continue;
      assert.equal(
        typeof entry[field],
        'string',
        `${entryId(entry, index)}: ${field} must be a string`,
      );
      let parsed;
      assert.doesNotThrow(
        () => {
          parsed = new URL(entry[field]);
        },
        `${entryId(entry, index)}: ${field} is not a parseable URL`,
      );
      assert.equal(parsed.protocol, 'https:');
      assert.ok(
        parsed.host.length > 0,
        `${entryId(entry, index)}: ${field} has no host`,
      );
    }
  });
});

// `primaryUrl` is `announcementUrl || talkUrl`; if both are absent the logo
// anchor renders with `href={undefined}`, producing a non-navigable link.
test('every card has a primary link to hang the logo anchor on', () => {
  awards.awards.forEach((entry, index) => {
    assert.ok(
      entry.announcementUrl || entry.talkUrl,
      `${entryId(entry, index)}: needs an announcementUrl or talkUrl for the card anchor`,
    );
  });
});

// `award` is a machine slug and `awardLabel` is its display string. The pair is
// rendered per card, so two labels for one slug read as two different awards.
test('each award slug maps to exactly one display label', () => {
  const labels = new Map();
  awards.awards.forEach((entry, index) => {
    assert.match(
      String(entry.award),
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      `${entryId(entry, index)}: award must be a kebab-case slug`,
    );
    const known = labels.get(entry.award);
    if (known === undefined) labels.set(entry.award, entry.awardLabel);
    else
      assert.equal(
        entry.awardLabel,
        known,
        `${entryId(entry, index)}: award "${entry.award}" is labelled both "${known}" and "${entry.awardLabel}"`,
      );
  });
});

// Guards the other direction: if WinnerCard starts rendering a field, this test
// fails until that field is added to the contract above rather than silently
// rendering `undefined`.
test('WinnerCard renders no entry field this contract does not cover', () => {
  const destructure = componentSource.match(
    /function WinnerCard\(\{ entry \}\) \{\s*const \{([\s\S]*?)\} = entry;/,
  );
  assert.ok(destructure, 'could not read the WinnerCard destructuring block');
  const read = destructure[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const covered = new Set([
    ...RENDERED_TEXT_FIELDS,
    ...URL_FIELDS,
    'slug',
    'year',
    'award',
    'logo',
  ]);
  const uncovered = read.filter((name) => !covered.has(name));
  assert.deepEqual(
    uncovered,
    [],
    `WinnerCard reads ${uncovered.join(', ')}, which tests/awards-data.test.mjs does not assert`,
  );
});
