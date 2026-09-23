/**
 * Detection and removal of active (script-executing) content in SVG files.
 *
 * SVG is a document format, not just an image format. A browser that loads an
 * SVG directly (for example `/img/architectures/example/diagram.svg`) executes
 * any script it contains in the origin that served it. Assets imported from
 * third-party repositories therefore have to be treated as untrusted input.
 *
 * Detection normalizes attribute values before testing them so that entity and
 * control-character obfuscation (`java&#115;cript:`, `java\tscript:`) does not
 * slip past a naive substring match.
 */

/** Elements that exist solely to execute or bind script. */
const ACTIVE_ELEMENTS = ['script', 'handler', 'listener'];

/** URI schemes that execute script when navigated to or rendered. */
const ACTIVE_SCHEMES = ['javascript', 'vbscript', 'livescript', 'mocha'];

const ACTIVE_ELEMENT_PATTERN = new RegExp(
  `<\\s*(${ACTIVE_ELEMENTS.join('|')})\\b`,
  'i',
);

const EVENT_HANDLER_ATTRIBUTE = /\son[a-z]+\s*=/i;

/**
 * `<animate>`/`<set>` can assign a value to `href` at runtime, so an element
 * that is inert in the source becomes a javascript: link once the animation
 * begins. The element itself is the finding — its `to`/`values`/`from`
 * payloads are ordinary attribute values that no scheme scan would flag on an
 * element that is not itself a link.
 */
const ANIMATED_URI_ELEMENT =
  /<\s*(animate|set)\b[^>]*\battributeName\s*=\s*(?:"\s*(?:xlink:)?href\s*"|'\s*(?:xlink:)?href\s*'|(?:xlink:)?href\b)[^>]*>/gi;

const ATTRIBUTE_PATTERN =
  /\s([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;

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
 * Decode the HTML entity forms an attribute value may use to hide a scheme.
 * @param {string} value
 * @returns {string}
 */
function decodeEntities(value) {
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
    .replace(/&([a-z]+);?/gi, (match, name) => {
      const replacement = NAMED_ENTITIES[name.toLowerCase()];
      return replacement ?? match;
    });
}

/**
 * Collapse an attribute value to the form a browser's URL parser sees:
 * entities decoded, whitespace and control characters removed, lowercased.
 * @param {string} value
 * @returns {string}
 */
function normalizeUri(value) {
  // Decode twice: some generators emit double-encoded entities (&amp;#58;).
  return (
    decodeEntities(decodeEntities(value))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0020\u007f\u00a0\u2028\u2029]+/g, '')
      .toLowerCase()
  );
}

/**
 * Report whether a normalized attribute value carries a script-executing URI.
 * @param {string} value - Raw attribute value.
 * @returns {string|null} The offending scheme, or null.
 */
function activeScheme(value) {
  const normalized = normalizeUri(value);
  for (const scheme of ACTIVE_SCHEMES) {
    if (new RegExp(`(?:^|[^a-z0-9+.-])${scheme}:`, 'i').test(normalized)) {
      return `${scheme}:`;
    }
  }
  // `data:` URIs that carry markup execute script in the same way.
  const markup = normalized.match(
    /(?:^|[^a-z0-9+.-])(data:(?:text\/html|image\/svg\+xml))/,
  );
  if (markup) {
    return `${markup[1]}`;
  }
  return null;
}

/**
 * Describe every piece of active content found in an SVG source string.
 * @param {string} source - SVG file contents.
 * @returns {string[]} Human-readable descriptions, empty when the SVG is inert.
 */
export function findActiveContent(source) {
  const findings = [];

  const element = source.match(ACTIVE_ELEMENT_PATTERN);
  if (element) {
    findings.push(`contains a <${element[1].toLowerCase()}> element`);
  }

  const handlers = new Set();
  const schemes = new Set();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (/^on[a-z]+$/.test(name)) {
      handlers.add(name);
      continue;
    }

    const scheme = activeScheme(value);
    if (scheme) {
      schemes.add(`${name}="${scheme}..."`);
    }
  }

  // Catch unquoted/malformed handler attributes the attribute scanner misses.
  if (!handlers.size && EVENT_HANDLER_ATTRIBUTE.test(source)) {
    handlers.add('on*');
  }

  if (handlers.size) {
    findings.push(
      `contains event handler attribute(s): ${[...handlers].sort().join(', ')}`,
    );
  }
  for (const scheme of [...schemes].sort()) {
    findings.push(`contains a script URI in ${scheme}`);
  }

  const animated = new Set(
    [...source.matchAll(ANIMATED_URI_ELEMENT)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  for (const element of [...animated].sort()) {
    findings.push(
      `contains a <${element}> element that animates href (can install a script URI at runtime)`,
    );
  }

  return findings;
}

/**
 * Remove active content from an SVG source string.
 *
 * Removes script-bearing elements outright and drops offending attributes
 * while leaving inert markup untouched.
 * @param {string} source - SVG file contents.
 * @returns {{ source: string, removed: string[] }}
 */
export function stripActiveContent(source) {
  const removed = [];
  let output = source;

  for (const element of ACTIVE_ELEMENTS) {
    const paired = new RegExp(
      `<\\s*${element}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${element}\\s*>`,
      'gi',
    );
    const standalone = new RegExp(`<\\s*/?\\s*${element}\\b[^>]*>`, 'gi');
    for (const pattern of [paired, standalone]) {
      output = output.replace(pattern, () => {
        removed.push(`<${element}> element`);
        return '';
      });
    }
  }

  output = output.replace(ANIMATED_URI_ELEMENT, (match, element) => {
    removed.push(`<${element.toLowerCase()}> element animating href`);
    return '';
  });

  // Drop closing tags left orphaned by removing a paired animation element.
  if (removed.some((entry) => entry.endsWith('animating href'))) {
    output = output.replace(/<\s*\/\s*(?:animate|set)\s*>/gi, '');
  }

  output = output.replace(ATTRIBUTE_PATTERN, (match, name, dq, sq, uq) => {
    const attribute = name.toLowerCase();
    const value = dq ?? sq ?? uq ?? '';

    if (/^on[a-z]+$/.test(attribute)) {
      removed.push(`${attribute} attribute`);
      return '';
    }

    const scheme = activeScheme(value);
    if (scheme) {
      removed.push(`${attribute} attribute (${scheme})`);
      return '';
    }

    return match;
  });

  return { source: output, removed };
}
