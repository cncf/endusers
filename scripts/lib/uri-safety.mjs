/**
 * URI classification shared by the SVG scanner and the MDX scanner.
 *
 * Both gates decide the same two questions about a value they have already
 * extracted from a grammar-aware parse -- does it run script, and does it make
 * a visitor's browser contact another host -- so the answers live in one place.
 * A scheme the SVG gate rejects and the MDX gate accepts (or the reverse) is a
 * bypass of whichever gate is more permissive.
 */

/** URI schemes that execute script when navigated to or rendered. */
const ACTIVE_SCHEMES = ['javascript', 'vbscript', 'livescript', 'mocha'];

/**
 * `data:` media types a browser parses as a document or script rather than as
 * an image or font. Anything ending in `+xml` is a document type (XHTML, SVG,
 * MathML, RSS, XSLT), and a bare XML type runs `<script>` in the XHTML
 * namespace just as `text/html` does.
 */
const ACTIVE_DATA_TYPES = new Set([
  'text/html',
  'text/xml',
  'application/xml',
  'text/xsl',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
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
  return (
    decodeEntities(decodeEntities(String(value)))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0020\u007f]+/g, '')
      .toLowerCase()
  );
}

/**
 * Report whether a value carries a script-executing or document-bearing URI.
 *
 * @param {string} value - Raw value.
 * @returns {string|null} The offending scheme or `data:` media type, or null.
 */
export function activeScheme(value) {
  const normalized = normalizeUri(value);
  for (const scheme of ACTIVE_SCHEMES) {
    if (new RegExp(`(?:^|[^a-z0-9+.-])${scheme}:`).test(normalized)) {
      return `${scheme}:`;
    }
  }

  const data = normalized.match(/(?:^|[^a-z0-9+.-])data:([^,;]*)/);
  if (data) {
    const type = data[1];
    if (ACTIVE_DATA_TYPES.has(type) || type.endsWith('+xml')) {
      return `data:${type}`;
    }
  }
  return null;
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
