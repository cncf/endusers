/**
 * URI classification shared by the SVG scanner and the MDX scanner.
 *
 * Both gates decide the same two questions about a value they have already
 * extracted from a grammar-aware parse -- is its scheme on the allowlist, and
 * does it make a visitor's browser contact another host -- so the answers live
 * in one place. A scheme the SVG gate rejects and the MDX gate accepts (or the
 * reverse) is a bypass of whichever gate is more permissive.
 */

/**
 * URI schemes a gated value may carry. This is an allowlist: every other
 * scheme, including ones no browser implements yet, is rejected. A value with
 * no scheme at all is a relative reference or a fragment, which resolves on
 * this origin. Whether an allowed `http:`/`https:` value makes the browser
 * contact another host is a separate question, answered by
 * {@link remoteTarget}.
 */
export const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * `data:` media types a caller may opt into for embedded images: raster
 * formats a browser only ever decodes as pixels. Every other `data:` type --
 * SVG, HTML, XML, script, or a type invented later -- is rejected.
 */
export const RASTER_DATA_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const NAMED_ENTITIES = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  lf: '\n',
  cr: '\r',
  sol: '/',
  amp: '&',
};

/**
 * Decode the character-reference forms a value may use to hide a scheme.
 *
 * Callers have normally been through an XML or Markdown parser that decoded
 * one level already; decoding again is deliberate (a double-encoded
 * `&amp;#58;` is the reason) and costs nothing on a value without references.
 *
 * @param {string} value
 * @returns {string}
 */
export function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&#(\d+);?/g, (match, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(
      /&([a-z]+);?/gi,
      (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

/**
 * Collapse a value to the form a browser's URL parser sees: references
 * decoded, whitespace and control characters removed, lowercased.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeUri(value) {
  // Stryker disable Regex: `+` is redundant under /g -- replacing each control
  // character individually yields the same string as replacing runs.
  return (
    decodeEntities(decodeEntities(String(value)))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0020\u007f]+/g, '')
      .toLowerCase()
  );
  // Stryker restore Regex
}

/**
 * Report the scheme of a value when it is not on the allowlist.
 *
 * The value is normalized the way {@link normalizeUri} describes before its
 * scheme is read, so an entity-encoded or whitespace-split scheme is seen as
 * the browser sees it. Normalizing removes characters a browser would keep,
 * which can only make a scheme appear where the browser sees a relative
 * reference -- an over-rejection, never a miss.
 *
 * @param {string} value - Raw value.
 * @param {{ rasterData?: boolean }} [options] - `rasterData` also admits
 *   `data:` URIs of a {@link RASTER_DATA_TYPES} media type.
 * @returns {string|null} The rejected scheme (`foo:`) or `data:` media type
 *   (`data:text/html`), or null when the value is allowed.
 */
export function disallowedScheme(value, { rasterData = false } = {}) {
  const normalized = normalizeUri(value);
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
  if (scheme === undefined || ALLOWED_SCHEMES.has(scheme)) return null;
  if (scheme !== 'data') return `${scheme}:`;
  // Stryker disable next-line Regex: reachable only once the anchored scheme
  // match proved `normalized` starts with `data:`, so the leftmost unanchored
  // match is already at index 0.
  const type = /^data:([^,;]*)/.exec(normalized)[1];
  return rasterData && RASTER_DATA_TYPES.has(type) ? null : `data:${type}`;
}

/**
 * Report whether a value points at a resource on another host.
 *
 * Only absolute http(s) and protocol-relative values qualify. A fragment, a
 * relative path and a `data:` URI all resolve without a network request.
 *
 * @param {string} value - Raw attribute or CSS value.
 * @returns {string|null} The normalized remote target, or null.
 */
export function remoteTarget(value) {
  const normalized = normalizeUri(value);
  // A scheme does not make a value absolute on its own: the parser only
  // enters the relative states when the value's scheme equals the base
  // document's. The site is served over https (`url` in
  // docusaurus.config.js), so `https:local.png` is the path `local.png` on
  // this origin and is correctly left alone below.
  //
  // `http:` is a *different* special scheme, so it never reaches those
  // states. It goes to "special authority ignore slashes", which skips
  // however many `/` or `\` follow -- including none -- and reads what comes
  // next as the host. `http:evil.example/b.png`, `http:/evil.example/b.png`
  // and `http:\evil.example/b.png` therefore load from evil.example exactly
  // as `http://evil.example/b.png` does, while matching neither the `//`
  // test nor the two-or-more-separator rewrite below.
  //
  // Being cleartext does not make the reference harmless: a browser that
  // blocks the mixed-content subresource has already been told to, and one
  // that auto-upgrades it to https still sends the request -- with the
  // visitor's IP, User-Agent and Referer -- to the host named here.
  //
  // Lookahead: a value with nothing after the separators (`http:`, `http:/`,
  // `http://`) has no host, and one continuing with `?` or `#` is not a URL
  // the parser accepts, so neither fetches anything to report.
  const insecureAuthority = /^http:[/\\]*(?=[^/\\?#])/.exec(normalized);
  if (insecureAuthority) {
    return `http://${normalized.slice(insecureAuthority[0].length)}`;
  }

  // The URL parser treats `\` as `/` in the scheme and authority prefix of a
  // special-scheme URL, and the site is served over https, so every relative
  // reference resolves against a special-scheme base. `\\host`, `/\host`,
  // `\/host` and `https:\\host` therefore reach `host` exactly as `//host`
  // does.
  //
  // Only the leading run of separators is translated. A single separator
  // keeps the value on this origin (`\host` is the path `/host`), and an
  // interior backslash is an ordinary path character.
  const authority = normalized.replace(
    // Stryker disable next-line Regex: the replacement rewrites a separator run
    // to exactly `//` and never moves content forward, so a match at a non-zero
    // index keeps its prefix and cannot newly satisfy the test below.
    /^(https?:)?[/\\]{2,}/,
    (match, scheme) => `${scheme ?? ''}//`,
  );
  if (/^https?:\/\//.test(authority) || authority.startsWith('//')) {
    return authority;
  }
  return null;
}

/** Trim a target for display so one long data-bearing URL cannot flood output. */
export function describeTarget(target) {
  return target.length > 120 ? `${target.slice(0, 117)}...` : target;
}
