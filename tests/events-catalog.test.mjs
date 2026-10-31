// Contract for scripts/lib/events-catalog.mjs, the only reader of event page
// front matter (ADR 0012). sidebars.js and scripts/lib/events-catalog-plugin.mjs
// both consume it, so a rule it fails to enforce is a page the build accepts
// and then lists in the wrong place, and an ordering it gets wrong is wrong
// on the index and in the sidebar at once.
//
// The fixture cases drive each rule and each ordering arm through a temp
// docs tree; the final case reads the live docs/events/ tree so that a real
// page breaking the contract fails here, not in `docusaurus build`.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EventPageError,
  collectEvents,
  compareEvents,
  groupByYear,
  recordFromFrontMatter,
} from '../scripts/lib/events-catalog.mjs';

const liveDocsDir = fileURLToPath(new URL('../docs', import.meta.url));

const VALID = {
  title: 'KubeCon + CloudNativeCon North America 2026',
  description: 'End user talks in Salt Lake City.',
  event: {
    start: '2026-11-09',
    end: '2026-11-12',
    location: 'Salt Lake City, Utah',
    url: 'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/',
  },
};

function withEvent(overrides) {
  return { ...VALID, event: { ...VALID.event, ...overrides } };
}

function page(data) {
  const lines = ['---', `title: ${data.title}`];
  if (data.description !== undefined)
    lines.push(`description: ${data.description}`);
  if (data.event) {
    lines.push('event:');
    for (const [key, value] of Object.entries(data.event)) {
      lines.push(`  ${key}: ${value}`);
    }
  }
  lines.push('---', '', 'Body.', '');
  return lines.join('\n');
}

function makeDocs(files) {
  const docsDir = mkdtempSync(join(tmpdir(), 'endusers-events-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(docsDir, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return docsDir;
}

test('a valid page becomes a record with derived ids and trimmed strings', () => {
  const record = recordFromFrontMatter('2026', 'kubecon-na', {
    ...VALID,
    title: '  KubeCon NA 2026  ',
  });
  assert.deepEqual(record, {
    id: '2026/kubecon-na',
    docId: 'events/2026/kubecon-na',
    route: '/events/2026/kubecon-na',
    year: 2026,
    title: 'KubeCon NA 2026',
    description: VALID.description,
    start: '2026-11-09',
    end: '2026-11-12',
    location: 'Salt Lake City, Utah',
    url: VALID.event.url,
  });
});

test('an EventPageError names the page the author edited', () => {
  const error = new EventPageError('events/2026/x.md', 'broken');
  assert.equal(error.name, 'EventPageError');
  assert.equal(error.page, 'events/2026/x.md');
  assert.equal(error.message, 'docs/events/2026/x.md: broken');
  assert.ok(error instanceof Error);
});

const REJECTED = [
  ['no front matter mapping', null, /front matter must be a YAML mapping/],
  [
    'a missing title',
    { ...VALID, title: '' },
    /"title" must be a non-empty string/,
  ],
  [
    'a non-string description',
    { ...VALID, description: 42 },
    /"description" must be a non-empty string/,
  ],
  [
    'no event block',
    { ...VALID, event: undefined },
    /must carry an "event:" mapping/,
  ],
  [
    'an event block that is a list',
    { ...VALID, event: [] },
    /must carry an "event:" mapping/,
  ],
  [
    'an event block that is a scalar',
    { ...VALID, event: 'KubeCon' },
    /must carry an "event:" mapping/,
  ],
  [
    'a start that is not a date',
    withEvent({ start: 'Nov 9' }),
    /event\.start must be an ISO calendar date/,
  ],
  [
    'a start that is a YAML date object, not a string',
    withEvent({ start: new Date('2026-11-09') }),
    /event\.start must be an ISO calendar date/,
  ],
  [
    'an end that names no real day',
    withEvent({ end: '2026-11-31' }),
    /event\.end must be an ISO calendar date/,
  ],
  [
    'a month of 13',
    withEvent({ end: '2026-13-01' }),
    /event\.end must be an ISO calendar date/,
  ],
  [
    'an end before the start',
    withEvent({ start: '2026-11-12', end: '2026-11-09' }),
    /event\.end \(2026-11-09\) is before event\.start \(2026-11-12\)/,
  ],
  [
    'a start outside the year directory',
    withEvent({ start: '2025-11-09', end: '2025-11-12' }),
    /event\.start \(2025-11-09\) is not in the page's year directory \(2026\)/,
  ],
  [
    'a blank location',
    withEvent({ location: '   ' }),
    /event\.location must be a non-empty string/,
  ],
  [
    'no url',
    withEvent({ url: undefined }),
    /event\.url must be a non-empty string/,
  ],
  [
    'a relative url',
    withEvent({ url: '/events' }),
    /event\.url must be an absolute http\(s\) URL/,
  ],
  [
    'a url buried in prose',
    withEvent({ url: 'see https://events.linuxfoundation.org/' }),
    /event\.url must be an absolute http\(s\) URL/,
  ],
];

test('a plain http url is accepted', () => {
  const record = recordFromFrontMatter(
    '2026',
    'kubecon-na',
    withEvent({ url: 'http://example.org/kubecon' }),
  );
  assert.equal(record.url, 'http://example.org/kubecon');
});

for (const [label, data, message] of REJECTED) {
  test(`rejects ${label}`, () => {
    assert.throws(
      () => recordFromFrontMatter('2026', 'kubecon-na', data),
      (error) =>
        error instanceof EventPageError &&
        error.page === 'events/2026/kubecon-na.md' &&
        message.test(error.message),
    );
  });
}

test('a single-day event (end equal to start) is valid', () => {
  const record = recordFromFrontMatter(
    '2026',
    'summit',
    withEvent({ start: '2026-11-09', end: '2026-11-09' }),
  );
  assert.equal(record.start, record.end);
});

test('compareEvents orders by start desc, then end desc, then title asc', () => {
  const base = { title: 'B', start: '2026-03-01', end: '2026-03-03' };
  const laterStart = { ...base, start: '2026-06-01', end: '2026-06-01' };
  const laterEnd = { ...base, end: '2026-03-04' };
  const titleA = { ...base, title: 'A' };

  assert.ok(compareEvents(laterStart, base) < 0, 'later start sorts first');
  assert.ok(compareEvents(base, laterStart) > 0);
  // A long event that ends after a later-starting one still sorts by start.
  const longEarly = { ...base, start: '2026-01-01', end: '2026-12-31' };
  assert.ok(
    compareEvents(laterStart, longEarly) < 0,
    'start wins even when the earlier event ends later',
  );
  assert.ok(compareEvents(laterEnd, base) < 0, 'later end breaks a start tie');
  assert.ok(compareEvents(base, laterEnd) > 0);
  assert.ok(compareEvents(titleA, base) < 0, 'title breaks a full date tie');
  assert.equal(compareEvents(base, { ...base }), 0);
});

test('collectEvents reads only pages inside year directories and sorts latest first', () => {
  const docsDir = makeDocs({
    'events/index.md': page({ title: 'Index' }),
    'events/README.txt': 'not a page',
    'events/drafts/kubecon-eu.md': page(withEvent({})),
    'events/archive-2024/kubecon-na.md': page(withEvent({})),
    'events/2024-archive/kubecon-na.md': page(withEvent({})),
    'events/2026/kubecon-na.md': page(VALID),
    'events/2026/kubecon-na.md.backup': page(VALID),
    'events/2026/kubecon-eu.mdx': page(
      withEvent({
        start: '2026-03-23',
        end: '2026-03-26',
        location: 'Amsterdam',
      }),
    ),
    'events/2026/notes.txt': 'not a page',
    'events/2025/kubecon-na.md': page(
      withEvent({
        start: '2025-11-10',
        end: '2025-11-13',
        location: 'Atlanta',
      }),
    ),
  });
  mkdirSync(join(docsDir, 'events/2026/images'));
  try {
    const events = collectEvents(docsDir);
    assert.deepEqual(
      events.map((event) => event.id),
      ['2026/kubecon-na', '2026/kubecon-eu', '2025/kubecon-na'],
    );
    assert.deepEqual(
      events.map((event) => event.location),
      ['Salt Lake City, Utah', 'Amsterdam', 'Atlanta'],
    );
  } finally {
    rmSync(docsDir, { recursive: true, force: true });
  }
});

test('collectEvents surfaces the first invalid page as an EventPageError', () => {
  const docsDir = makeDocs({
    'events/2026/kubecon-na.md': page(VALID),
    'events/2026/broken.md': page(withEvent({ location: '' })),
  });
  try {
    assert.throws(
      () => collectEvents(docsDir),
      (error) =>
        error instanceof EventPageError &&
        error.page === 'events/2026/broken.md',
    );
  } finally {
    rmSync(docsDir, { recursive: true, force: true });
  }
});

test('groupByYear keeps newest year first and preserves order within a year', () => {
  const events = [
    { id: 'a', year: 2026 },
    { id: 'b', year: 2026 },
    { id: 'c', year: 2024 },
    { id: 'd', year: 2025 },
  ];
  assert.deepEqual(groupByYear(events), [
    { year: 2026, events: [events[0], events[1]] },
    { year: 2025, events: [events[3]] },
    { year: 2024, events: [events[2]] },
  ]);
  assert.deepEqual(groupByYear([]), []);
});

test('every live event page under docs/events/ satisfies the contract', () => {
  const events = collectEvents(liveDocsDir);
  assert.ok(events.length > 0, 'docs/events/ has no event pages');
  assert.deepEqual(
    events,
    [...events].sort(compareEvents),
    'collectEvents must return latest-first order',
  );
  const years = groupByYear(events).map((group) => group.year);
  assert.deepEqual(
    years,
    [...years].sort((a, b) => b - a),
  );
});
