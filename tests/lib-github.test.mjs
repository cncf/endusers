import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeGitHubHeaders,
  githubAllPages,
  githubFetch,
} from '../scripts/lib/github.mjs';

const DEFAULT_USER_AGENT = 'cncf-endusers-site-build';

// Replaces globalThis.fetch for the duration of fn, recording every call.
async function withStubbedFetch(impl, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  return { ok, status, headers: new Headers(headers), json: async () => body };
}

// Answers each fetch call from `pages` in order, refusing anything unscripted.
function pagedFetch(pages) {
  let index = 0;
  return () => {
    const page = pages[index];
    index += 1;
    if (!page) throw new Error('unexpected request');
    return jsonResponse(page.body, page);
  };
}

// Captures console.warn for the duration of fn.
async function withCapturedWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn(warnings);
  } finally {
    console.warn = original;
  }
}

const FIRST_PAGE = 'https://api.github.com/orgs/cncf/repos?per_page=100';
const SECOND_PAGE =
  'https://api.github.com/orgs/cncf/repos?per_page=100&page=2';
const nextLink = (url, separator = '; ') => `<${url}>${separator}rel="next"`;

test('makeGitHubHeaders requests the GitHub JSON media type', () => {
  const headers = makeGitHubHeaders();
  assert.equal(headers.Accept, 'application/vnd.github+json');
});

test('makeGitHubHeaders uses the shared default User-Agent', () => {
  assert.equal(makeGitHubHeaders()['User-Agent'], DEFAULT_USER_AGENT);
});

test('makeGitHubHeaders honours a caller-supplied User-Agent', () => {
  const headers = makeGitHubHeaders(undefined, 'cncf-endusers-metrics');
  assert.equal(headers['User-Agent'], 'cncf-endusers-metrics');
});

test('makeGitHubHeaders omits Authorization when no token is given', () => {
  assert.equal('Authorization' in makeGitHubHeaders(), false);
  assert.equal('Authorization' in makeGitHubHeaders(undefined), false);
});

test('makeGitHubHeaders omits Authorization for an empty-string token', () => {
  // process.env.GH_TOKEN is '' for unauthenticated workflow runs; an empty
  // bearer token would make GitHub reject the request outright.
  assert.equal('Authorization' in makeGitHubHeaders(''), false);
});

test('makeGitHubHeaders sends a bearer token when one is given', () => {
  assert.equal(
    makeGitHubHeaders('ghp_example').Authorization,
    'Bearer ghp_example',
  );
});

test('makeGitHubHeaders returns an independent object per call', () => {
  const first = makeGitHubHeaders('ghp_example');
  first.Accept = 'mutated';
  assert.equal(makeGitHubHeaders().Accept, 'application/vnd.github+json');
});

test('githubFetch returns the parsed JSON body on success', async () => {
  await withStubbedFetch(
    () => jsonResponse({ login: 'cncf' }),
    async () => {
      assert.deepEqual(await githubFetch('https://api.github.com/orgs/cncf'), {
        login: 'cncf',
      });
    },
  );
});

test('githubFetch forwards auth and User-Agent headers to fetch', async () => {
  await withStubbedFetch(
    () => jsonResponse({}),
    async (calls) => {
      await githubFetch(
        'https://api.github.com/rate_limit',
        'ghp_example',
        'ua-test',
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.github.com/rate_limit');
      assert.deepEqual(calls[0].options.headers, {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ua-test',
        Authorization: 'Bearer ghp_example',
      });
    },
  );
});

test('githubFetch falls back to the default User-Agent', async () => {
  await withStubbedFetch(
    () => jsonResponse({}),
    async (calls) => {
      await githubFetch('https://api.github.com/rate_limit');
      assert.equal(calls[0].options.headers['User-Agent'], DEFAULT_USER_AGENT);
      assert.equal('Authorization' in calls[0].options.headers, false);
    },
  );
});

test('githubFetch throws with the status and URL on a non-2xx response', async () => {
  await withStubbedFetch(
    () => jsonResponse({ message: 'Not Found' }, { ok: false, status: 404 }),
    async () => {
      await assert.rejects(
        githubFetch('https://api.github.com/orgs/missing'),
        /GitHub API 404: https:\/\/api\.github\.com\/orgs\/missing/,
      );
    },
  );
});

test('githubFetch surfaces rate-limit responses as errors rather than data', async () => {
  await withStubbedFetch(
    () =>
      jsonResponse(
        { message: 'rate limit exceeded' },
        { ok: false, status: 403 },
      ),
    async () => {
      await assert.rejects(
        githubFetch('https://api.github.com/orgs/cncf'),
        /GitHub API 403/,
      );
    },
  );
});

test('githubFetch does not swallow network failures', async () => {
  await withStubbedFetch(
    () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    },
    async () => {
      await assert.rejects(
        githubFetch('https://api.github.com/orgs/cncf'),
        /ENOTFOUND/,
      );
    },
  );
});

test('githubAllPages follows rel="next" and concatenates every page in order', async () => {
  const headers = makeGitHubHeaders('ghp_example', 'ua-pages');
  await withStubbedFetch(
    pagedFetch([
      {
        body: [{ id: 1 }, { id: 2 }],
        headers: {
          link: `<https://api.github.com/x?page=9>; rel="prev", ${nextLink(SECOND_PAGE)}, <https://api.github.com/x?page=3>; rel="last"`,
        },
      },
      { body: [{ id: 3 }] },
    ]),
    async (calls) => {
      assert.deepEqual(await githubAllPages(FIRST_PAGE, headers), [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);
      assert.deepEqual(
        calls.map(({ url }) => url),
        [FIRST_PAGE, SECOND_PAGE],
      );
      for (const call of calls) assert.deepEqual(call.options, { headers });
    },
  );
});

test('githubAllPages accepts a Link header with no space before rel', async () => {
  await withStubbedFetch(
    pagedFetch([
      { body: ['a'], headers: { link: nextLink(SECOND_PAGE, ';') } },
      { body: ['b'] },
    ]),
    async (calls) => {
      assert.deepEqual(await githubAllPages(FIRST_PAGE, {}), ['a', 'b']);
      assert.equal(calls.length, 2);
    },
  );
});

test('githubAllPages stops after a page without a Link header', async () => {
  await withStubbedFetch(pagedFetch([{ body: ['only'] }]), async (calls) => {
    assert.deepEqual(await githubAllPages(FIRST_PAGE, {}), ['only']);
    assert.equal(calls.length, 1);
  });
});

test('githubAllPages ignores a Link header that has no rel="next"', async () => {
  await withStubbedFetch(
    pagedFetch([
      {
        body: ['x'],
        headers: { link: `<${SECOND_PAGE}>; rel="last"` },
      },
    ]),
    async (calls) => {
      assert.deepEqual(await githubAllPages(FIRST_PAGE, {}), ['x']);
      assert.equal(calls.length, 1);
    },
  );
});

test('githubAllPages resolves a relative rel="next" against the first origin', async () => {
  await withStubbedFetch(
    pagedFetch([
      { body: [1], headers: { link: nextLink('/orgs/cncf/repos?page=2') } },
      { body: [2] },
    ]),
    async (calls) => {
      assert.deepEqual(await githubAllPages(FIRST_PAGE, {}), [1, 2]);
      assert.equal(
        calls[1].url,
        'https://api.github.com/orgs/cncf/repos?page=2',
      );
    },
  );
});

test('githubAllPages throws with the status and the page URL on a non-2xx response', async () => {
  await withStubbedFetch(
    pagedFetch([
      { body: [1], headers: { link: nextLink(SECOND_PAGE) } },
      { body: { message: 'boom' }, ok: false, status: 502 },
    ]),
    async () => {
      await assert.rejects(
        githubAllPages(FIRST_PAGE, {}),
        new RegExp(
          `^Error: GitHub API 502: ${SECOND_PAGE.replace(/[?.]/g, '\\$&')}$`,
        ),
      );
    },
  );
});

test('githubAllPages refuses to carry the token to a cross-origin rel="next"', async () => {
  await withCapturedWarnings(async (warnings) => {
    await withStubbedFetch(
      pagedFetch([
        {
          body: ['kept'],
          headers: { link: nextLink('https://evil.example/orgs/cncf/repos') },
        },
      ]),
      async (calls) => {
        assert.deepEqual(await githubAllPages(FIRST_PAGE, {}), ['kept']);
        assert.equal(calls.length, 1);
      },
    );
    assert.deepEqual(warnings, [
      'Ignoring cross-origin Link rel="next" target: https://evil.example',
    ]);
  });
});

test('githubAllPages stops on an unparseable rel="next" target', async () => {
  await withCapturedWarnings(async (warnings) => {
    await withStubbedFetch(
      pagedFetch([
        { body: ['kept'], headers: { link: nextLink('https://[') } },
      ]),
      async (calls) => {
        assert.deepEqual(await githubAllPages(FIRST_PAGE, {}), ['kept']);
        assert.equal(calls.length, 1);
      },
    );
    assert.deepEqual(warnings, [
      'Ignoring unparseable Link rel="next" target: https://[',
    ]);
  });
});
