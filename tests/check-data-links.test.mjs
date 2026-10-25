import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KNOWN_BROKEN_URLS,
  RENDERED_DATA_FILES,
  checkUrl,
  collectUrls,
  mapWithConcurrency,
  verdictForError,
  verdictForStatus,
} from '../scripts/lib/data-links.mjs';
import { runScriptWithFetchMock } from './helpers-fetch-mock.mjs';

test('collectUrls walks nested data and records every location of a URL', () => {
  const urls = collectUrls({
    'data/a.json': {
      homepageUrl: 'https://example.com/',
      nested: [
        { sourceUrl: 'https://example.com/' },
        'https://other.example/x',
      ],
      notAUrl: 'example.com',
      prose: 'see https://example.com/ for details',
      mail: 'mailto:hello@example.com',
      ftp: 'ftp://example.com/',
      upper: 'HTTPS://example.com/',
      relative: '/img/logo.svg',
      internal: 'https://endusers.cncf.io/community/',
      local: 'http://localhost:3000/',
      malformed: 'https://exa mple.com/',
      count: 3,
      flag: null,
    },
    'data/b.json': ['https://other.example/x'],
  });
  assert.deepEqual(
    [...urls.entries()],
    [
      [
        'https://example.com/',
        ['data/a.json.homepageUrl', 'data/a.json.nested[0].sourceUrl'],
      ],
      ['https://other.example/x', ['data/a.json.nested[1]', 'data/b.json[0]']],
    ],
  );
});

test('verdicts: 2xx/3xx ok, 404/410 broken, every other status unverifiable', () => {
  assert.equal(verdictForStatus(200), 'ok');
  assert.equal(verdictForStatus(301), 'ok');
  assert.equal(verdictForStatus(399), 'ok');
  assert.equal(verdictForStatus(404), 'broken');
  assert.equal(verdictForStatus(410), 'broken');
  for (const status of [199, 400, 401, 403, 405, 406, 429, 500, 503]) {
    assert.equal(verdictForStatus(status), 'unverifiable', String(status));
  }
});

test('verdicts: only a gone host turns a failed fetch into rot', () => {
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH']) {
    assert.equal(
      verdictForError(new TypeError('fetch failed', { cause: { code } })),
      'broken',
      code,
    );
  }
  assert.equal(
    verdictForError(
      new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
    ),
    'unverifiable',
  );
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  assert.equal(verdictForError(timeout), 'unverifiable');
  assert.equal(
    verdictForError(new Error('redirect count exceeded')),
    'unverifiable',
  );
  assert.equal(
    verdictForError(new TypeError('x', { cause: 'text' })),
    'unverifiable',
  );
  assert.equal(verdictForError(null), 'unverifiable');
  assert.equal(verdictForError('string'), 'unverifiable');
});

test('checkUrl follows redirects with a browser-shaped request and drains the body', async () => {
  const calls = [];
  let cancelled = false;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 302, body: { cancel: async () => (cancelled = true) } };
  };
  assert.deepEqual(
    await checkUrl('https://example.com/', { fetchImpl, timeoutMs: 50 }),
    { url: 'https://example.com/', verdict: 'ok', detail: 'HTTP 302' },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'follow');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.match(
    calls[0].init.headers['user-agent'],
    /^Mozilla\/5\.0 .*endusers\.cncf\.io/,
  );
  assert.match(calls[0].init.headers.accept, /text\/html/);
  assert.equal(cancelled, true);

  assert.deepEqual(
    await checkUrl('https://example.com/gone', {
      fetchImpl: async () => ({ status: 404 }),
    }),
    { url: 'https://example.com/gone', verdict: 'broken', detail: 'HTTP 404' },
  );
});

test('checkUrl reports the cause of a failed fetch', async () => {
  const dns = new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND dead.example'), {
      code: 'ENOTFOUND',
    }),
  });
  assert.deepEqual(
    await checkUrl('https://dead.example/', {
      fetchImpl: async () => {
        throw dns;
      },
    }),
    {
      url: 'https://dead.example/',
      verdict: 'broken',
      detail: 'fetch failed: getaddrinfo ENOTFOUND dead.example',
    },
  );
  assert.deepEqual(
    await checkUrl('https://slow.example/', {
      fetchImpl: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      },
    }),
    {
      url: 'https://slow.example/',
      verdict: 'unverifiable',
      detail: 'fetch failed',
    },
  );
  assert.deepEqual(
    await checkUrl('https://odd.example/', {
      fetchImpl: async () => {
        throw 'not an error';
      },
    }),
    {
      url: 'https://odd.example/',
      verdict: 'unverifiable',
      detail: 'not an error',
    },
  );
});

test('checkUrl aborts a request that outlives its timeout', async () => {
  const result = await checkUrl('https://hang.example/', {
    timeoutMs: 5,
    fetchImpl: (url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  });
  assert.equal(result.verdict, 'unverifiable');
  assert.match(result.detail, /timeout|aborted/i);
});

test('mapWithConcurrency keeps order and never exceeds the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, n));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(results, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  assert.deepEqual(await mapWithConcurrency([1], 4, async (n) => n), [1]);
});

test('the rendered file list leaves out the raw landscape snapshot and curated roster', () => {
  assert.ok(RENDERED_DATA_FILES.includes('data/members.json'));
  assert.ok(RENDERED_DATA_FILES.includes('data/community-people.json'));
  assert.ok(!RENDERED_DATA_FILES.includes('data/enduser-landscape.json'));
  assert.ok(!RENDERED_DATA_FILES.includes('data/community-roster.json'));
  for (const [url, reason] of KNOWN_BROKEN_URLS) {
    assert.match(url, /^https?:\/\//);
    assert.match(reason, /#\d+/, `${url} must cite a tracking issue`);
  }
});

const FIXTURE_FILES = Object.fromEntries(
  RENDERED_DATA_FILES.map((file) => [file, '{}']),
);

function run(routes, members) {
  return runScriptWithFetchMock({
    script: 'check-data-links.mjs',
    fixtures: {
      ...FIXTURE_FILES,
      'data/members.json': JSON.stringify(members),
    },
    routes,
  });
}

test('the script passes when every rendered URL resolves or is merely unverifiable', () => {
  const result = run(
    [
      { match: 'https://ok.example/', status: 200 },
      { match: 'https://blocked.example/', status: 403 },
      { match: 'https://www.walmartlabs.com', networkError: 'fetch failed' },
    ],
    {
      members: [
        { homepageUrl: 'https://ok.example/' },
        {
          homepageUrl: 'https://blocked.example/',
          again: 'https://ok.example/',
        },
        { homepageUrl: 'https://www.walmartlabs.com' },
      ],
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^unverifiable: https:\/\/blocked\.example\/ \(HTTP 403\)$/m,
  );
  assert.match(
    result.stdout,
    /^known: https:\/\/www\.walmartlabs\.com \(fetch failed; cncf\/landscape still lists/m,
  );
  assert.match(
    result.stdout,
    /^ {4}at data\/members\.json\.members\[1\]\.homepageUrl$/m,
  );
  assert.doesNotMatch(result.stdout, /^(ok|broken|stale):/m);
  assert.match(
    result.stdout,
    /3 URL\(s\) in \d+ file\(s\): 1 ok, 1 unverifiable, 1 known, 0 broken, 0 stale/,
  );
});

test('the script fails on a rotten URL and names where it renders from', () => {
  const result = run([{ match: 'https://gone.example/', status: 410 }], {
    members: [{ homepageUrl: 'https://gone.example/' }],
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /^broken: https:\/\/gone\.example\/ \(HTTP 410\)\n {4}at data\/members\.json\.members\[0\]\.homepageUrl$/m,
  );
  assert.equal(result.stderr, '');
});

test('the script fails when an allow-listed URL resolves again', () => {
  const result = run([{ match: 'https://www.walmartlabs.com', status: 200 }], {
    members: [{ homepageUrl: 'https://www.walmartlabs.com' }],
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /^stale: https:\/\/www\.walmartlabs\.com \(HTTP 200; /m,
  );
  assert.match(result.stderr, /remove it from KNOWN_BROKEN_URLS/);
});
