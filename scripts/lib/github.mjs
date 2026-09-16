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
export function makeGitHubHeaders(token, userAgent = 'cncf-endusers-site-build') {
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
  const response = await fetch(url, { headers: makeGitHubHeaders(token, userAgent) });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response.json();
}
