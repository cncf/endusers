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

/**
 * Elements whose `href`/`xlink:href` makes the browser fetch and render a
 * separate resource from the host in the value.
 *
 * `link` is here for the same reason the HTML-only elements below are: it is
 * reachable inside `<foreignObject>`, where `<link rel="stylesheet" href>`
 * fetches a third-party stylesheet on load.
 *
 * `a` is deliberately absent. A hyperlink is navigation the visitor chooses,
 * not a load the page performs, and draw.io exports legitimately carry one
 * (every imported diagram exported with text problems links to
 * drawio.com/doc/faq/...), so flagging it would fail the existing corpus.
 */
const RESOURCE_ELEMENTS = new Set([
  'image',
  'use',
  'feimage',
  'script',
  'filter',
  'link',
]);

/**
 * A start tag with its attribute section. Quoted runs are matched as units so
 * a raw `>` inside an attribute value -- legal in XML, where only `<` and `&`
 * must be escaped -- cannot end the tag early and hide the attributes after it.
 */
const TAG_PATTERN =
  /<\s*([A-Za-z_][-A-Za-z0-9_.:]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const STYLE_BLOCK_PATTERN = new RegExp(
  `<\\s*${NS_PREFIX}style\\b(?:"[^"]*"|'[^']*'|[^>"'])*>([\\s\\S]*?)<\\s*/\\s*${NS_PREFIX}style\\s*>`,
  'gi',
);

/** A CSS `url(...)` target, quoted or bare. Covers `@font-face` `src` too. */
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi;

/**
 * An `@import` whose target is a bare string rather than a `url(...)`.
 *
 * `@import "https://evil.example/x.css";` is valid CSS and fetches the
 * stylesheet exactly as the `url()` form does, but carries no `url(` token for
 * CSS_URL_PATTERN to find. The `url()` form stays CSS_URL_PATTERN's business;
 * a target matched by both is reported once, because findRemoteReferences
 * collects descriptions in a Set.
 */
const CSS_IMPORT_PATTERN = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Report whether a value points at a resource on another host.
 *
 * Only absolute http(s) and protocol-relative values qualify. A fragment, a
 * relative path and a `data:` URI all resolve without a network request --
 * draw.io embeds raster artwork as `data:` routinely -- and `data:` markup is
 * already the scheme scanner's business, not this one's.
 *
 * @param {string} value - Raw attribute or CSS value.
 * @returns {string|null} The normalized remote target, or null.
 */
function remoteTarget(value) {
  const normalized = normalizeUri(value);
  if (/^https?:\/\//.test(normalized) || normalized.startsWith('//')) {
    return normalized;
  }
  return null;
}

/** Trim a target for display so one long data-bearing URL cannot flood output. */
function describeTarget(target) {
  return target.length > 120 ? `${target.slice(0, 117)}...` : target;
}

/**
 * Describe every remote resource reference in an SVG source string.
 *
 * Distinct from {@link findActiveContent}: these references execute nothing,
 * but a browser fetches each one from a host the diagram's author chose, which
 * discloses the visitor's IP address, User-Agent and Referer to that host.
 * Imported artwork is mirrored locally for exactly this reason (see
 * `scripts/lib/project-assets.mjs`); the diagrams themselves are held to the
 * same standard here.
 *
 * @param {string} source - SVG file contents.
 * @returns {string[]} Human-readable descriptions, empty when nothing is remote.
 */
export function findRemoteReferences(source) {
  const findings = new Set();

  for (const tag of String(source).matchAll(TAG_PATTERN)) {
    const element = localName(tag[1]).toLowerCase();
    const attributes = tag[2] || '';

    for (const match of attributes.matchAll(ATTRIBUTE_PATTERN)) {
      const name = localName(match[1].toLowerCase());
      const value = match[2] ?? match[3] ?? match[4];

      if (
        (name === 'href' && RESOURCE_ELEMENTS.has(element)) ||
        name === 'src'
      ) {
        const target = remoteTarget(value);
        if (target) {
          findings.add(
            `references a remote resource in <${element}> ${match[1].toLowerCase()}: ${describeTarget(target)}`,
          );
        }
        continue;
      }

      // Every attribute value, not just `style`. SVG presentation attributes
      // (`fill`, `filter`, `mask`, `clip-path`, `marker-*`, ...) take the same
      // `url(...)` syntax as the CSS property of the same name, so
      // `fill="url(https://evil.example/x.svg#g)"` is the identical remote
      // fetch as `style="fill:url(https://evil.example/x.svg#g)"`. Scanning
      // only `style` let the presentation-attribute spelling walk past the
      // gate. A value with no `url(`/`@import` token yields nothing, so this
      // costs the other attributes nothing.
      for (const target of cssTargets(value)) {
        findings.add(
          name === 'style'
            ? `references a remote resource in a style attribute: ${describeTarget(target)}`
            : `references a remote resource in a ${match[1].toLowerCase()} presentation attribute: ${describeTarget(target)}`,
        );
      }
    }
  }

  for (const block of String(source).matchAll(STYLE_BLOCK_PATTERN)) {
    for (const target of cssTargets(block[1] || '')) {
      findings.add(
        `references a remote resource in a <style> block: ${describeTarget(target)}`,
      );
    }
  }

  return [...findings].sort();
}

/**
 * Collect the remote targets in a fragment of CSS, from both `url(...)` and
 * the bare-string `@import` form.
 * @param {string} css
 * @returns {string[]}
 */
function cssTargets(css) {
  const targets = [];
  for (const pattern of [CSS_URL_PATTERN, CSS_IMPORT_PATTERN]) {
    for (const match of String(css).matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];
      const target = remoteTarget(value);
      if (target) targets.push(target);
    }
  }
  return targets;
}

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
    const value = match[2] ?? match[3] ?? match[4];

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
 *
 * The removal runs to a fixed point rather than once. Deleting an element
 * splices the characters on either side of it together, and those characters
 * can form an active element that was not in the input: `<scr<embed/>ipt>`
 * becomes `<script>` once the `<embed>` between the halves of the word is
 * removed. `script` is stripped before `embed`, so a single pass returns that
 * reassembled element intact -- active content manufactured out of input the
 * detector called inert. Every pass strictly shortens the source, so
 * iterating until it stops changing terminates.
 *
 * @param {string} source - SVG file contents.
 * @returns {{ source: string, removed: string[] }}
 * @throws {Error} If active content survives the loop. Callers write this
 *   output to the site origin verbatim, so a source the detector still flags
 *   must never be handed back as sanitized.
 */
export function stripActiveContent(source) {
  const removed = [];
  let output = String(source);
  let previous;
  do {
    previous = output;
    output = stripOnce(output, removed);
  } while (output !== previous);

  const residual = findActiveContent(output);
  if (residual.length) {
    throw new Error(
      `Could not strip active content from SVG: ${residual.join('; ')}`,
    );
  }

  return { source: output, removed };
}

/**
 * One removal pass: every active element, event handler attribute, script URI
 * and href-animating element the patterns can see in `source`.
 *
 * @param {string} source - SVG source as it stands at the start of the pass.
 * @param {string[]} removed - Accumulator, appended to in place.
 * @returns {string} The source with this pass's removals applied.
 */
function stripOnce(source, removed) {
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
    const value = dq ?? sq ?? uq;

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

  return output;
}
