// Shared helpers for scripts/ reading the public cncf.io WordPress REST API
// (https://www.cncf.io/wp-json/wp/v2). Centralizes the page-walking, the
// "past the last page" 400 handling, and the decoding of the HTML entities
// WordPress leaves in `title.rendered`, so the two call sites (case studies,
// radar reports) can't drift out of sync on any of them.

/**
 * Fetches every page of a cncf.io WordPress REST API collection endpoint and
 * concatenates the results.
 *
 * WordPress sometimes advertises more pages via `x-wp-totalpages` than it
 * will actually serve; a 400 on any page after the first is treated as the
 * real end of the collection rather than an error.
 *
 * @param {string} api - Base API URL, e.g. 'https://www.cncf.io/wp-json/wp/v2'
 * @param {string} path - Endpoint path (and query string) relative to `api`
 * @returns {Promise<Array<unknown>>}
 */
export async function fetchAllPages(api, path) {
  const results = [];
  let page = 1;
  for (;;) {
    const response = await fetch(
      `${api}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    if (!response.ok) {
      if (response.status === 400 && page > 1) break; // past the last page
      throw new Error(`cncf.io API ${response.status}: ${path} (page ${page})`);
    }
    const batch = await response.json();
    results.push(...batch);
    const totalPages = Number(response.headers.get('x-wp-totalpages') || '1');
    if (page >= totalPages || !batch.length) break;
    page += 1;
  }
  return results;
}

/**
 * Decodes the HTML character references WordPress leaves in rendered text
 * such as `title.rendered` (`&amp;`, `&#038;`, `&#8217;`), returning plain
 * text suitable for a JSON data file.
 *
 * This is a presentation decoder for trusted upstream text, not the
 * security-oriented `decodeEntities` in scripts/lib/uri-safety.mjs, which
 * also resolves hexadecimal and named references and tolerates a missing
 * semicolon because it exists to defeat scheme-hiding.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
