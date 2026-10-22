// Behavioural contract of scripts/lib/cncf-wp-api.mjs, driven in-process
// against a stubbed global fetch.
//
// tests/cncf-wp-api-call-sites.test.mjs pins *which module owns* the page
// walk; the collectors' own suites drive it only through a sandboxed child
// process, which no in-process coverage (unit or mutation) can see. These
// tests pin what the walk does: the exact URLs it requests, where the
// pagination stops, and which failures end the collection versus abort it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEntities, fetchAllPages } from '../scripts/lib/cncf-wp-api.mjs';

const API = 'https://www.cncf.io/wp-json/wp/v2';

// Replaces globalThis.fetch with a stub that answers each URL from `pages`
// in order and refuses any request the test did not script. Returns the
// result of fn together with the URLs requested.
async function withPages(pages, fn) {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    const page = pages[requested.length - 1];
    if (!page) throw new Error(`unexpected request: ${url}`);
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(page.headers ?? {}),
      json: async () => page.body ?? [],
    };
  };
  try {
    return await fn(requested);
  } finally {
    globalThis.fetch = original;
  }
}

const pageUrl = (path, page, separator = '?') =>
  `${API}/${path}${separator}per_page=100&page=${page}`;

test('fetchAllPages requests page 1 with per_page=100 and a ? separator', async () => {
  await withPages([{ body: [{ id: 1 }] }], async (requested) => {
    assert.deepEqual(await fetchAllPages(API, 'posts'), [{ id: 1 }]);
    assert.deepEqual(requested, [pageUrl('posts', 1)]);
  });
});

test('fetchAllPages appends to an existing query string with &', async () => {
  await withPages([{ body: [] }], async (requested) => {
    assert.deepEqual(await fetchAllPages(API, 'posts?categories=7'), []);
    assert.deepEqual(requested, [pageUrl('posts?categories=7', 1, '&')]);
  });
});

test('fetchAllPages walks exactly x-wp-totalpages pages and concatenates in order', async () => {
  const headers = { 'x-wp-totalpages': '3' };
  await withPages(
    [
      { body: [1, 2], headers },
      { body: [3], headers },
      { body: [4, 5], headers },
    ],
    async (requested) => {
      assert.deepEqual(await fetchAllPages(API, 'posts'), [1, 2, 3, 4, 5]);
      assert.deepEqual(
        requested,
        [1, 2, 3].map((n) => pageUrl('posts', n)),
      );
    },
  );
});

test('fetchAllPages stops on the last advertised page, not one past it', async () => {
  const headers = { 'x-wp-totalpages': '2' };
  await withPages(
    [
      { body: ['a'], headers },
      { body: ['b'], headers },
    ],
    async (requested) => {
      assert.deepEqual(await fetchAllPages(API, 'posts'), ['a', 'b']);
      assert.equal(requested.length, 2);
    },
  );
});

test('fetchAllPages stops at an empty batch before the advertised total', async () => {
  const headers = { 'x-wp-totalpages': '5' };
  await withPages(
    [
      { body: ['a'], headers },
      { body: [], headers },
    ],
    async (requested) => {
      assert.deepEqual(await fetchAllPages(API, 'posts'), ['a']);
      assert.equal(requested.length, 2);
    },
  );
});

test('fetchAllPages treats a missing x-wp-totalpages header as a single page', async () => {
  await withPages([{ body: ['only'] }], async (requested) => {
    assert.deepEqual(await fetchAllPages(API, 'posts'), ['only']);
    assert.equal(requested.length, 1);
  });
});

test('fetchAllPages treats a 400 after the first page as the end of the collection', async () => {
  await withPages(
    [{ body: ['a'], headers: { 'x-wp-totalpages': '9' } }, { status: 400 }],
    async (requested) => {
      assert.deepEqual(await fetchAllPages(API, 'posts'), ['a']);
      assert.equal(requested.length, 2);
    },
  );
});

test('fetchAllPages throws on a 400 for the first page', async () => {
  await withPages([{ status: 400 }], async () => {
    await assert.rejects(
      fetchAllPages(API, 'posts'),
      /^Error: cncf\.io API 400: posts \(page 1\)$/,
    );
  });
});

test('fetchAllPages throws on a non-400 failure after the first page', async () => {
  await withPages(
    [{ body: ['a'], headers: { 'x-wp-totalpages': '3' } }, { status: 500 }],
    async () => {
      await assert.rejects(
        fetchAllPages(API, 'posts?x=1'),
        /^Error: cncf\.io API 500: posts\?x=1 \(page 2\)$/,
      );
    },
  );
});

test('fetchAllPages throws rather than reading the body of a failed page 1', async () => {
  await withPages([{ status: 503, body: ['unexpected'] }], async () => {
    await assert.rejects(fetchAllPages(API, 'posts'), /cncf\.io API 503/);
  });
});

test('decodeEntities resolves decimal references and &amp; only', () => {
  assert.equal(
    decodeEntities('Fish &amp; Chips &#8217;s &#038; co &lt;b&gt; &#x3a;'),
    'Fish & Chips \u2019s & co &lt;b&gt; &#x3a;',
  );
});
