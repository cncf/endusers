import assert from 'node:assert/strict';
import test from 'node:test';
import { makeGitHubHeaders, githubFetch } from '../scripts/lib/github.mjs';

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

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

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
