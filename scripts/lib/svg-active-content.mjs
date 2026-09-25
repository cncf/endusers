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

/**
 * Elements that execute or bind script, or that embed a separate document.
 *
 * `iframe`, `embed` and `object` are only reachable inside `<foreignObject>`,
 * where they load an attacker-chosen document into the origin serving the SVG.
 * `foreignObject` itself stays allowed: editors such as draw.io emit it for
 * ordinary text, and imported diagrams already rely on it.
 */
const ACTIVE_ELEMENTS = [
  'script',
  'handler',
  'listener',
  'iframe',
  'embed',
  'object',
];

/** URI schemes that execute script when navigated to or rendered. */
const ACTIVE_SCHEMES = ['javascript', 'vbscript', 'livescript', 'mocha'];

/**
 * An optional XML namespace prefix.
 *
 * Standalone SVG is served as image/svg+xml and parsed as XML, where the
 * prefix is arbitrary and only the namespace URI it binds matters:
 * `<x:script xmlns:x="http://www.w3.org/2000/svg">` is a script element and
 * executes. Every active-element pattern therefore has to tolerate a prefix,
 * or a one-character edit walks past the whole gate.
 */
const NS_PREFIX = '(?:[a-z_][-a-z0-9_.]*:)?';

const ACTIVE_ELEMENT_PATTERN = new RegExp(
  `<\\s*${NS_PREFIX}(${ACTIVE_ELEMENTS.join('|')})\\b`,
  'i',
);

const EVENT_HANDLER_ATTRIBUTE = /\son[a-z]+\s*=/i;

/**
 * Attributes that carry a whole document as their value. `srcdoc` markup is
 * entity-encoded, so no scheme scan of the value would ever flag it; the
 * attribute name is the finding.
 */
const DOCUMENT_ATTRIBUTES = new Set(['srcdoc']);

/**
 * `<animate>`/`<set>` can assign a value to `href` at runtime, so an element
 * that is inert in the source becomes a javascript: link once the animation
 * begins. The element itself is the finding — its `to`/`values`/`from`
 * payloads are ordinary attribute values that no scheme scan would flag on an
 * element that is not itself a link.
 */
const ANIMATED_URI_ELEMENT = new RegExp(
  `<\\s*${NS_PREFIX}(animate|set)\\b[^>]*\\battributeName\\s*=\\s*(?:"\\s*(?:xlink:)?href\\s*"|'\\s*(?:xlink:)?href\\s*'|(?:xlink:)?href\\b)[^>]*>`,
  'gi',
);

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
 * Strip any XML namespace prefix from a qualified name.
 * @param {string} name
 * @returns {string}
 */
function localName(name) {
  const colon = name.lastIndexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
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
  const documents = new Set();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';

    if (/^on[a-z]+$/.test(name)) {
      handlers.add(name);
      continue;
    }

    if (DOCUMENT_ATTRIBUTES.has(localName(name))) {
      documents.add(name);
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
  for (const attribute of [...documents].sort()) {
    findings.push(
      `contains an embedded document attribute: ${attribute} (carries markup that executes in this origin)`,
    );
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
      `<\\s*${NS_PREFIX}${element}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${NS_PREFIX}${element}\\s*>`,
      'gi',
    );
    const standalone = new RegExp(
      `<\\s*/?\\s*${NS_PREFIX}${element}\\b[^>]*>`,
      'gi',
    );
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
    output = output.replace(
      new RegExp(`<\\s*/\\s*${NS_PREFIX}(?:animate|set)\\s*>`, 'gi'),
      '',
    );
  }

  output = output.replace(ATTRIBUTE_PATTERN, (match, name, dq, sq, uq) => {
    const attribute = name.toLowerCase();
    const value = dq ?? sq ?? uq ?? '';

    if (/^on[a-z]+$/.test(attribute)) {
      removed.push(`${attribute} attribute`);
      return '';
    }

    if (DOCUMENT_ATTRIBUTES.has(localName(attribute))) {
      removed.push(`${attribute} attribute (embedded document)`);
      return '';
    }

    const scheme = activeScheme(value);
    if (scheme) {
      removed.push(`${attribute} attribute (${scheme})`);
      return '';
    }

    return match;
  });

  // Catch unquoted/malformed handler attributes ATTRIBUTE_PATTERN cannot
  // represent (a value-less `onload=` or a backtick-delimited value), the
  // same gap findActiveContent's on* fallback exists to cover. Replacing with
  // a single space rather than deleting keeps a neighboring attribute from
  // fusing with the tag name or a preceding attribute.
  output = output.replace(/\son[a-z]+\s*=\s*(?:`[^`]*`)?/gi, (match) => {
    removed.push(`${match.trim()} attribute (unquoted/malformed handler)`);
    return ' ';
  });

  return { source: output, removed };
}
