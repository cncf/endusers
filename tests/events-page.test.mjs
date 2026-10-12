// Source-side contract for docs/events/index.md, the `/events` route the
// primary navbar links to. Nothing tested this page before this file: no test
// under tests/ read docs/events at all, and a markdown doc has no executable
// lines, so the coverage report cannot see the gap either.
//
// The page states its own maintenance contract in prose -- "This section is
// reviewed quarterly ... so it never shows a past event as upcoming. Last
// verified: <date>." -- and that promise was unenforced. The assertions below
// are that promise, plus the build-time dependencies the page carries: a
// `require()`-ed hero image and internal link targets.
//
// The "upcoming is still upcoming" check is deliberately wall-clock sensitive
// in the one direction the page commits to. When the listed event ends, this
// suite going red *is* the quarterly review reminder; the fix is a content
// edit, not a test edit. tests/awards-data.test.mjs sets the precedent for
// wall-clock assertions here with its `verifiedAt <= Date.now()` guard.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');
const eventsDoc = join(docsRoot, 'events', 'index.md');

const raw = readFileSync(eventsDoc, 'utf8');
const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
assert.ok(fence, 'docs/events/index.md has no frontmatter fence');
const [, frontmatter, body] = fence;

function frontmatterValue(key) {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(frontmatter);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : undefined;
}

// Returns the body text of a top-level `## <heading>` section, up to the next
// `## ` heading or end of document.
function section(heading) {
  const start = new RegExp(`^##\\s+${heading}\\s*$`, 'm').exec(body);
  if (!start) return undefined;
  const after = body.slice(start.index + start[0].length);
  const next = /^##\s+/m.exec(after);
  return next ? after.slice(0, next.index) : after;
}

test('the page is a listed route with the frontmatter the navbar relies on', () => {
  assert.ok(frontmatterValue('title'), 'docs/events/index.md needs a title');
  assert.ok(
    frontmatterValue('description'),
    'docs/events/index.md needs a description; it is the meta description for /events',
  );

  // The navbar links to /events, so the doc must not be unlisted: an unlisted
  // doc is dropped from the sidebar and search index, leaving a navbar item
  // pointing at a page the site otherwise disowns.
  assert.equal(
    /^unlisted:\s*true\s*$/m.test(frontmatter),
    false,
    'the navbar links to /events, so the doc cannot be unlisted',
  );
});

test('the page separates upcoming events from past ones, in that order', () => {
  const upcoming = /^##\s+Upcoming\s*$/m.exec(body);
  const past = /^##\s+Past\s*$/m.exec(body);

  assert.ok(upcoming, 'docs/events/index.md has no "## Upcoming" section');
  assert.ok(past, 'docs/events/index.md has no "## Past" section');
  assert.ok(
    upcoming.index < past.index,
    'the "## Upcoming" section must come before "## Past"',
  );
});

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Matches the dateline form the page uses for an event: a bolded
// "<Month> <day>[-<day>], <year>" opening, where the dash may be an ASCII
// hyphen or the en dash the prose actually uses. Only the *last* day of the
// range matters: an event is upcoming until the day it ends is over.
const DATELINE_RE = new RegExp(
  String.raw`\*\*(${MONTHS.join('|')})\s+(\d{1,2})(?:\s*[-\u2013\u2014]\s*(\d{1,2}))?,\s*(\d{4})`,
  'g',
);

function datelines(text) {
  return [...text.matchAll(DATELINE_RE)].map(
    ([matched, month, first, last, year]) => ({
      matched,
      // End of the final day, UTC: an event is not past until that day is over
      // anywhere the reader might be. The suite runs under TZ=UTC.
      endsAt: Date.UTC(
        Number(year),
        MONTHS.indexOf(month),
        Number(last ?? first),
        23,
        59,
        59,
        999,
      ),
    }),
  );
}

test('the "Upcoming" section names at least one dated event', () => {
  // Guards the staleness check below from passing vacuously if the datelines
  // are ever reformatted into a shape this file cannot read.
  assert.ok(
    datelines(section('Upcoming') ?? '').length > 0,
    'no dateline matched in "## Upcoming"; either the section lost its events or the dateline format changed and this contract needs updating with it',
  );
});

test('no event listed as upcoming has already happened', () => {
  const stale = datelines(section('Upcoming') ?? '').filter(
    (dateline) => dateline.endsAt < Date.now(),
  );

  assert.deepEqual(
    stale.map((dateline) => dateline.matched),
    [],
    'docs/events/index.md lists a past event under "## Upcoming". The page promises it "never shows a past event as upcoming" -- move the entry to "## Past" and refresh the "Last verified" date',
  );
});

test('the "Last verified" date is real and is not in the future', () => {
  // The note lives in a blockquote and wraps mid-phrase, so the marker has to
  // come off before the phrase can be matched across the line break.
  const unquoted = body.replace(/^\s*>\s?/gm, '');
  const match = /Last\s+verified:\s*(\d{4}-\d{2}-\d{2})/.exec(unquoted);
  assert.ok(
    match,
    'docs/events/index.md no longer states a "Last verified:" date; the page claims a quarterly review, so the date it was last reviewed has to stay on the page',
  );

  const verified = new Date(`${match[1]}T00:00:00Z`);
  assert.ok(
    !Number.isNaN(verified.getTime()),
    `Last verified: ${match[1]} is not a real date`,
  );
  assert.ok(
    verified.getTime() <= Date.now(),
    `Last verified: ${match[1]} is in the future; the page would claim a review that has not happened`,
  );
});

test('every @site asset the page requires exists on disk', () => {
  // `require('@site/static/img/...').default` is resolved by webpack during
  // the Docusaurus build, so a renamed or deleted asset fails the build rather
  // than degrading. Nothing else in the suite reads this doc's asset
  // references.
  const required = [
    ...body.matchAll(/require\(\s*['"]@site\/([^'"]+)['"]\s*\)/g),
  ].map(([, path]) => path);

  assert.ok(
    required.length > 0,
    'no @site asset reference found; this contract needs updating if the page stopped embedding one',
  );

  const missing = required.filter((path) => !existsSync(join(repoRoot, path)));
  assert.deepEqual(missing, [], 'docs/events/index.md requires missing assets');
});

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.mdx?$/.test(entry) ? [full] : [];
  });
}

function normalizeRoute(route) {
  const withoutFragment = route.split('#')[0].split('?')[0];
  if (withoutFragment === '/' || withoutFragment === '') return '/';
  return withoutFragment.replace(/\/+$/, '');
}

// Mirrors the Docusaurus docs-plugin route derivation for routeBasePath '/',
// the same way tests/site-config.test.mjs does: an explicit frontmatter slug
// wins, otherwise the path relative to docs/ is used, with index files
// collapsing onto their containing directory. Restated rather than imported so
// that an unintended change fails in both places.
function routeForDoc(file) {
  const text = readFileSync(file, 'utf8');
  const matched = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const slug = matched ? /^slug:\s*(\S+)\s*$/m.exec(matched[1]) : null;
  if (slug) {
    const value = slug[1].replace(/^['"]|['"]$/g, '');
    if (value.startsWith('/')) return normalizeRoute(value);
  }
  const rel = relative(docsRoot, file).replace(/\\/g, '/');
  return normalizeRoute(
    `/${rel.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')}`,
  );
}

const docRoutes = new Set(walk(docsRoot).map(routeForDoc));

test('every internal link on the page resolves to a doc route', () => {
  // Covers both idioms the page uses: `<Link to="/...">` in JSX and
  // `[text](/...)` in markdown. tests/jsx-link-hygiene.test.mjs checks link
  // hygiene only for sources under src/, so nothing validated these.
  const targets = [
    ...[...body.matchAll(/<Link\s+[^>]*to=["'](\/[^"'#]*)/g)].map(
      ([, to]) => to,
    ),
    ...[...body.matchAll(/\]\(\s*(\/[^)\s#]*)/g)].map(([, to]) => to),
  ];

  assert.ok(
    targets.length > 0,
    'no internal link found; this contract needs updating if the page stopped linking into the site',
  );

  const broken = targets.filter(
    (target) => !docRoutes.has(normalizeRoute(target)),
  );
  assert.deepEqual(
    broken,
    [],
    'docs/events/index.md links to routes no doc serves',
  );
});
