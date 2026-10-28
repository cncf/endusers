// Outbound URLs that the site renders from data/ files, and the policy for
// deciding whether one of them has rotted.
//
// `npm run check:links` resolves the links written in Markdown; nothing
// resolved the ones a component reads out of a generated JSON file, so a dead
// member homepage (#1856) was only ever noticed by a reader. This module gives
// scripts/check-data-links.mjs the list of rendered files, the URL walk and
// the verdict rules; the script owns the I/O.

/**
 * Data files whose string values reach the page as link or image targets.
 *
 * `data/enduser-landscape.json` is deliberately absent: it is the raw
 * landscape snapshot, and most of its entries never render (only the end user
 * members in `members.json` do), so a rotten URL there is not a defect an end
 * user can see. `community-roster.json` is curated input to
 * `community-people.json`, which is checked instead.
 */
export const RENDERED_DATA_FILES = [
  'data/architectures/catalog.json',
  'data/awards.json',
  'data/case-studies.json',
  'data/community-groups.json',
  'data/community-people.json',
  'data/end-user-talks.json',
  'data/members.json',
  'data/metrics.json',
  'data/projects-born.json',
  'data/radar-reports.json',
];

/**
 * URLs known to be rotten whose fix lives upstream, keyed to the issue that
 * tracks the upstream change. The check reports them as `known` instead of
 * failing, and fails once one resolves again so the entry is retired.
 */
export const KNOWN_BROKEN_URLS = new Map([]);

/** Hosts whose pages are this site's own; the build already checks them. */
const INTERNAL_HOSTS = new Set(['endusers.cncf.io', 'localhost']);

/**
 * Collect every distinct outbound http(s) URL in a set of parsed data files.
 *
 * @param {Record<string, unknown>} documents repo-relative path -> parsed JSON
 * @returns {Map<string, string[]>} URL -> `file:json.path` locations it is used at
 */
export function collectUrls(documents) {
  const found = new Map();
  for (const [file, document] of Object.entries(documents)) {
    walk(document, file, (url, location) => {
      found.set(url, [...(found.get(url) ?? []), location]);
    });
  }
  return found;
}

function walk(value, path, visit) {
  if (typeof value === 'string') {
    if (isOutbound(value)) visit(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, visit));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, `${path}.${key}`, visit);
    }
  }
}

function isOutbound(value) {
  if (!/^https?:\/\//.test(value)) return false;
  let host;
  try {
    ({ hostname: host } = new URL(value));
  } catch {
    return false;
  }
  return !INTERNAL_HOSTS.has(host);
}

/**
 * Map an HTTP status to a verdict.
 *
 * A 4xx that says "not here" is rot. A 4xx or 5xx that says "not to you"
 * (bot blocks, rate limits, method refusals, origin faults) proves nothing
 * about the page, so it is reported but does not fail the run; a gate that
 * failed on every anti-bot 403 would be red every week and ignored.
 *
 * @param {number} status
 * @returns {'ok' | 'broken' | 'unverifiable'}
 */
export function verdictForStatus(status) {
  if (status >= 200 && status < 400) return 'ok';
  if (status === 404 || status === 410) return 'broken';
  return 'unverifiable';
}

/** Error codes under `fetch failed` that mean the host itself is gone. */
const GONE_HOST_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH']);

/**
 * Map a failed fetch to a verdict.
 *
 * Only a host that does not resolve or refuses the connection is rot. Every
 * other failure (timeout, TLS quirk, a redirect loop or malformed response
 * that a browser tolerates) proves nothing about what a reader would see.
 *
 * @param {unknown} error
 * @returns {'broken' | 'unverifiable'}
 */
export function verdictForError(error) {
  const code =
    error &&
    typeof error === 'object' &&
    error.cause &&
    typeof error.cause === 'object'
      ? error.cause.code
      : undefined;
  return GONE_HOST_CODES.has(code) ? 'broken' : 'unverifiable';
}

/**
 * Resolve one URL and classify the result.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{url: string, verdict: string, detail: string}>}
 */
export async function checkUrl(
  url,
  { fetchImpl = fetch, timeoutMs = 15_000 } = {},
) {
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Some origins answer a bare client with a block page; a browser-shaped
        // header gets the same answer a reader's browser does.
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) endusers.cncf.io link check',
        accept: 'text/html,*/*;q=0.8',
      },
    });
    await response.body?.cancel();
    return {
      url,
      verdict: verdictForStatus(response.status),
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      url,
      verdict: verdictForError(error),
      detail: describeError(error),
    };
  }
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  );
  return results;
}
