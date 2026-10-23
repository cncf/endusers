// Shared GitHub API helpers for scripts/ — centralizes auth header construction
// so that auth format changes and token wiring only need to happen in one place.

/**
 * Returns GitHub API request headers, including an Authorization bearer token
 * if one is provided.
 *
 * @param {string} [token] - Optional GitHub token (e.g. process.env.GH_TOKEN)
 * @param {string} [userAgent] - User-Agent string for the calling script
 * @returns {Record<string, string>}
 */
export function makeGitHubHeaders(
  token,
  userAgent = 'cncf-endusers-site-build',
) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': userAgent,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Fetches a GitHub API URL and returns parsed JSON.  Throws on non-2xx status.
 *
 * @param {string} url
 * @param {string} [token]
 * @param {string} [userAgent]
 * @returns {Promise<unknown>}
 */
export async function githubFetch(url, token, userAgent) {
  const response = await fetch(url, {
    headers: makeGitHubHeaders(token, userAgent),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response.json();
}

/**
 * Follows GitHub API `Link: rel="next"` pagination and returns the
 * concatenated JSON array across all pages. Throws on any non-2xx status.
 *
 * The Authorization header travels with every paginated request, so a Link
 * header naming a different origin would hand the token to that host. Only
 * continue paginating within the origin the first request was sent to.
 *
 * @param {string} url - First page URL.
 * @param {Record<string, string>} headers - Request headers, typically from
 *   {@link makeGitHubHeaders}.
 * @returns {Promise<unknown[]>}
 */
export async function githubAllPages(url, headers) {
  const origin = new URL(url).origin;
  const results = [];
  let next = url;
  while (next) {
    const response = await fetch(next, { headers });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${next}`);
    results.push(...(await response.json()));
    // Stryker disable next-line StringLiteral: equivalent. The fallback is
    // read only by the `rel="next"` match below, so any value without that
    // shape ends pagination exactly as the empty string does. Pinned by "a
    // GitHub response with no Link header ends pagination" in
    // tests/mutation-equivalence-premises.test.mjs.
    const link = response.headers.get('link') || '';
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    next = match ? sameOriginNext(match[1], origin) : null;
  }
  return results;
}

function sameOriginNext(candidate, origin) {
  let parsed;
  try {
    parsed = new URL(candidate, origin);
  } catch {
    console.warn(`Ignoring unparseable Link rel="next" target: ${candidate}`);
    return null;
  }
  if (parsed.origin !== origin) {
    console.warn(
      `Ignoring cross-origin Link rel="next" target: ${parsed.origin}`,
    );
    return null;
  }
  return parsed.toString();
}
