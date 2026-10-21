/**
 * Allowlist gate for active (script-executing) content in SVG files.
 *
 * SVG is a document format, not just an image format. A browser that loads an
 * SVG directly (for example `/img/architectures/example/diagram.svg`) executes
 * any script it contains in the origin that served it. Assets imported from
 * third-party repositories therefore have to be treated as untrusted input.
 *
 * The gate is an allowlist. Every element and attribute is resolved to its
 * namespace and local name and must appear in one of the lists below; every
 * URL a browser would follow or fetch (an `href`, a CSS `url()`) must carry a
 * scheme on the allowlist in `./uri-safety.mjs`. Anything else is a finding,
 * and {@link stripActiveContent} removes it. A construct nobody has thought of
 * yet -- a new element, a new attribute, a new scheme -- is rejected by
 * default rather than waiting to be added to a list of known-bad patterns.
 *
 * This module reads SVG the way a browser does: as namespace-aware XML,
 * through a real XML parser (`sax`, strict mode), and reads embedded CSS
 * through the CSS Syntax tokenizer (`css-tree`). Detection asks the resulting
 * element and attribute tree, and the resulting token stream, what they
 * contain. It never pattern matches over source text, so comments, CDATA
 * sections, entity and character references, CSS escapes, quote pairing and
 * namespace prefixes are resolved by the parsers rather than guessed at here.
 *
 * The scan fails closed. A document the XML parser rejects, or that declares
 * entities or a non-UTF-8 encoding, is itself a finding: this module cannot
 * vouch for bytes it cannot read the way a browser does.
 */

import sax from 'sax';
import { ident, string, tokenize, tokenTypes, url } from 'css-tree';
import {
  describeTarget,
  disallowedScheme,
  remoteTarget,
} from './uri-safety.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/**
 * SVG elements a diagram may contain: shapes, text, grouping and reuse,
 * paint servers, clipping and masking, and the filter primitives editors emit
 * for shadows and blurs. Every element that runs script, loads a document,
 * animates, or loads a font is absent (`script`, `animate`, `set`, `feImage`,
 * `font-face`, `cursor`, `view`, ...), and so is everything SVG adds later.
 *
 * `foreignObject` is allowed because draw.io emits it for ordinary text
 * labels; what it may contain is governed by {@link XHTML_ELEMENTS}.
 */
export const SVG_ELEMENTS = new Set([
  'a',
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
  'filter',
  'foreignObject',
  'g',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'style',
  'svg',
  'switch',
  'symbol',
  'text',
  'textPath',
  'title',
  'tspan',
  'use',
]);

/**
 * Unprefixed attributes allowed on the root `<svg>` element only, beyond
 * {@link SVG_ATTRIBUTES}. draw.io writes its editable diagram source, as
 * escaped XML text, into `content`; browsers attach no behaviour to it, and the
 * asset validator warns on it and strips it under `--fix`.
 */
export const SVG_ROOT_ATTRIBUTES = new Set(['content']);

/**
 * Unprefixed attributes allowed on an SVG element: geometry, paint, text and
 * filter parameters, and the SVG presentation attributes. None of them names a
 * handler, carries markup, or animates another attribute. `href` and every
 * presentation attribute that takes `url()` are additionally checked value by
 * value (see {@link findActiveContent}). `cursor` is absent because it loads
 * an image of its own.
 */
export const SVG_ATTRIBUTES = new Set([
  'alignment-baseline',
  'aria-describedby',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'baseProfile',
  'baseline-shift',
  'class',
  'clip',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-rendering',
  'cx',
  'cy',
  'd',
  'direction',
  'display',
  'dominant-baseline',
  'dx',
  'dy',
  'enable-background',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'filterUnits',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'fr',
  'fx',
  'fy',
  'gradientTransform',
  'gradientUnits',
  'height',
  'href',
  'id',
  'image-rendering',
  'in',
  'in2',
  'isolation',
  'k1',
  'k2',
  'k3',
  'k4',
  'lang',
  'lengthAdjust',
  'letter-spacing',
  'lighting-color',
  'marker-end',
  'marker-mid',
  'marker-start',
  'markerHeight',
  'markerUnits',
  'markerWidth',
  'mask',
  'maskContentUnits',
  'maskUnits',
  'mix-blend-mode',
  'mode',
  'offset',
  'opacity',
  'operator',
  'orient',
  'overflow',
  'paint-order',
  'pathLength',
  'patternContentUnits',
  'patternTransform',
  'patternUnits',
  'pointer-events',
  'points',
  'preserveAspectRatio',
  'primitiveUnits',
  'r',
  'refX',
  'refY',
  'requiredExtensions',
  'requiredFeatures',
  'result',
  'role',
  'rotate',
  'rx',
  'ry',
  'shape-rendering',
  'spreadMethod',
  'startOffset',
  'stdDeviation',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'style',
  'systemLanguage',
  'target',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'textLength',
  'transform',
  'transform-origin',
  'type',
  'unicode-bidi',
  'values',
  'vector-effect',
  'version',
  'viewBox',
  'visibility',
  'width',
  'word-spacing',
  'writing-mode',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
]);

/**
 * XHTML elements allowed inside `<foreignObject>`: the rich-text markup
 * draw.io writes for labels. No form, frame, embed, media, link, meta or base
 * element is listed, so a label cannot submit, load or navigate anything.
 */
export const XHTML_ELEMENTS = new Set([
  'a',
  'b',
  'br',
  'code',
  'div',
  'em',
  'font',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
]);

/** Unprefixed attributes allowed on an XHTML element. */
export const XHTML_ATTRIBUTES = new Set([
  'align',
  'class',
  'color',
  'dir',
  'face',
  'href',
  'id',
  'lang',
  'size',
  'style',
  'target',
  'title',
]);

/**
 * Attributes allowed in the XLink and XML namespaces, by local name.
 * `xml:base` is absent: it re-points every relative reference below it.
 */
export const XLINK_ATTRIBUTES = new Set(['href', 'title']);
export const XML_ATTRIBUTES = new Set(['lang', 'space']);

/**
 * Editor and metadata namespaces (RDF/Dublin Core/Creative Commons licence
 * blocks, Inkscape, Sodipodi, Adobe Illustrator). A browser implements no
 * behaviour for any element or attribute in these namespaces: it renders
 * nothing, runs no handler and fetches nothing, so every element and every
 * prefixed attribute in them is allowed. Their descendants are still checked
 * one by one, so an SVG element nested in a metadata element is held to the
 * lists above.
 */
export const METADATA_NAMESPACES = new Set([
  'http://creativecommons.org/ns#',
  'http://ns.adobe.com/AdobeIllustrator/10.0/',
  'http://ns.adobe.com/Extensibility/1.0/',
  'http://ns.adobe.com/Graphs/1.0/',
  'http://ns.adobe.com/SaveForWeb/1.0/',
  'http://purl.org/dc/elements/1.1/',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  'http://www.inkscape.org/namespaces/inkscape',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
]);

/** Unprefixed attributes the editors write on their own metadata elements. */
export const METADATA_ATTRIBUTES = new Set([
  'bleed',
  'bordercolor',
  'borderopacity',
  'bottomLeftOrigin',
  'gridtolerance',
  'guidetolerance',
  'height',
  'id',
  'margin',
  'objecttolerance',
  'pagecolor',
  'showgrid',
  'units',
  'width',
  'x',
  'y',
]);

/** Namespaces a document may declare. */
const NAMESPACES = new Set([
  SVG_NS,
  XHTML_NS,
  XLINK_NS,
  XML_NS,
  ...METADATA_NAMESPACES,
]);

/**
 * `data-*` attributes are author storage: the platform gives them no
 * behaviour, and nothing in an allowed document can read them. Illustrator
 * writes `data-name` and draw.io `data-cell-id`.
 */
const DATA_ATTRIBUTE = /^data-[a-z0-9._-]+$/;

/**
 * Elements whose `href` is navigation the visitor chooses rather than a load
 * the page performs. draw.io exports legitimately carry such links, so
 * flagging them would fail the existing corpus. Every other element's `href`
 * is treated as a fetch by {@link findRemoteReferences}.
 */
const NAVIGATION_ELEMENTS = new Set(['a']);

/**
 * CSS functions that take a bare string as a URL to fetch. `url()` with a
 * quoted argument is a function token, not a url token, so it belongs here
 * with the image functions.
 */
const URL_STRING_FUNCTIONS = new Set([
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
]);

/** Encodings under which a UTF-8 reading of the bytes is faithful. */
const SAFE_ENCODINGS = new Set(['utf-8', 'utf8', 'us-ascii', 'ascii']);

/**
 * Single-byte encodings whose 0x00-0x7F range is ASCII.
 *
 * Under these every structural character (`<`, `>`, `&`, quotes) occupies the
 * same byte it does in UTF-8, so markup tokenizes identically and only
 * non-ASCII text content reads differently -- a difference that cannot hide an
 * element or attribute from the scan. Multi-byte or ASCII-incompatible
 * encodings (UTF-16, UTF-7, Shift_JIS, EBCDIC) stay flagged: a lead byte can
 * swallow a following ASCII byte, or the whole byte-to-character mapping
 * shifts, and either lets a parser honoring the declaration see markup this
 * UTF-8 scan did not.
 */
const SINGLE_BYTE_ASCII_ENCODING =
  /^(?:iso-8859-\d{1,2}|windows-125[0-8]|latin[1-9])$/;

/**
 * Characters that only appear when a file was decoded with the wrong charset.
 *
 * The validators read every SVG as UTF-8. A UTF-16 file read that way turns
 * into NUL-riddled text (or U+FFFD replacements where the bytes are not valid
 * UTF-8 at all), and the parse then covers a string that is not what a browser
 * honoring the BOM or `encoding=` declaration parses.
 */
// eslint-disable-next-line no-control-regex
const MISDECODED_CHARACTER = /[\u0000\ufffd]/;

/**
 * Strip any XML namespace prefix from a qualified name.
 * @param {string} name
 * @returns {string}
 */
function localName(name) {
  const colon = name.lastIndexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

/**
 * Whether a DOCTYPE follows the prolog (whitespace, processing instructions and
 * comments). A linear walk rather than a pattern: nested lazy repetition over
 * `<?...?>` and `<!--...-->` backtracks exponentially on adversarial input.
 *
 * @param {string} source
 * @returns {boolean}
 */
function startsWithDoctype(source) {
  let index = 0;
  for (;;) {
    while (/[\s\uFEFF]/.test(source[index] ?? '')) index += 1;
    const closer = source.startsWith('<?', index)
      ? '?>'
      : source.startsWith('<!--', index)
        ? '-->'
        : null;
    if (!closer) break;
    const end = source.indexOf(closer, index + 2);
    if (end === -1) return false;
    index = end + closer.length;
  }
  return source.slice(index, index + 9).toUpperCase() === '<!DOCTYPE';
}

/**
 * Parse `source` as namespace-aware XML into a flat event list.
 *
 * `sax` is run in strict mode, with errors recorded and parsing resumed so a
 * malformed document still yields whatever it recovered: the scans below then
 * report both the malformation and anything they can still see. Namespace
 * prefixes are resolved, so each element and attribute carries the namespace
 * URI and local name a browser assigns it: the prefix is arbitrary
 * (`<x:script xmlns:x="http://www.w3.org/2000/svg">` is an SVG script
 * element), and an unbound prefix is a well-formedness error, as it is to a
 * browser.
 *
 * @param {string} source - SVG file contents.
 * @returns {{ events: object[], errors: string[] }}
 */
function parseXml(source) {
  const events = [];
  const errors = [];
  const parser = sax.parser(true, { xmlns: true });
  // sax resolves the HTML named entities even in strict mode. XML defines
  // five, and a browser parsing a standalone SVG treats any other reference as
  // a fatal error, so `&nbsp;` must not quietly become U+00A0 here.
  parser.ENTITIES = Object.create(sax.XML_ENTITIES);
  let depth = 0;
  let roots = 0;

  parser.onerror = (error) => {
    errors.push(error.message.split('\n')[0]);
    parser.error = null;
    parser.resume();
  };
  parser.onopentag = (tag) => {
    if (depth === 0) roots += 1;
    events.push({
      type: 'open',
      depth,
      name: tag.name,
      uri: tag.uri,
      local: tag.local,
      attributes: Object.values(tag.attributes).map(
        ({ name, value, uri, local }) => ({ name, value, uri, local }),
      ),
      selfClosing: tag.isSelfClosing,
    });
    depth += 1;
  };
  parser.onclosetag = (name) => {
    depth -= 1;
    events.push({ type: 'close', depth, name });
  };
  parser.ontext = (value) => events.push({ type: 'text', depth, value });
  parser.oncdata = (value) => events.push({ type: 'cdata', depth, value });
  parser.oncomment = (value) => events.push({ type: 'comment', depth, value });
  parser.ondoctype = (value) => events.push({ type: 'doctype', depth, value });
  parser.onprocessinginstruction = ({ name, body }) =>
    events.push({ type: 'pi', depth, name, body });

  parser.write(source).close();

  // sax accepts any number of top-level elements; an XML document has one.
  if (roots !== 1) {
    errors.push(roots === 0 ? 'No root element' : 'Multiple root elements');
  }
  // sax swallows a DOCTYPE whose subset never closes and parses what follows
  // as markup; a browser reads it as part of the subset.
  if (
    !events.some((event) => event.type === 'doctype') &&
    startsWithDoctype(source)
  ) {
    errors.push('Unterminated DOCTYPE');
  }
  return { events, errors };
}

/**
 * Every `<style>` element with its CSS text, in document order.
 *
 * The XML parser has already resolved CDATA sections and character references,
 * so a `</style>` inside CDATA is data and `&#117;rl(` is `url(`.
 *
 * @param {object[]} events
 * @returns {Array<{ event: object, css: string }>}
 */
function styleBlocks(events) {
  const blocks = [];
  const open = [];
  for (const event of events) {
    if (event.type === 'open' && localName(event.name) === 'style') {
      open.push(blocks.length);
      blocks.push({ event, css: '' });
    } else if (event.type === 'close' && localName(event.name) === 'style') {
      open.pop();
    } else if (
      (event.type === 'text' || event.type === 'cdata') &&
      open.length
    ) {
      blocks[open.at(-1)].css += event.value;
    }
  }
  return blocks;
}

/**
 * Collect every URL a fragment of CSS makes the browser fetch.
 *
 * The fragment is read through the CSS Syntax tokenizer, which is the same
 * tokenization a browser performs before it interprets anything: comments are
 * gone, escapes are decoded when a token is read (`\75rl(` is the function
 * `url(`), strings end where the specification says they end, and an
 * unquoted `url(...)` is one token. Three constructs fetch a URL:
 *
 * - an unquoted `url(...)` token;
 * - a function in {@link URL_STRING_FUNCTIONS} whose argument is a string,
 *   which covers `url("...")` and the bare-string forms of `image-set()`;
 * - `@import` followed by a string.
 *
 * A bad-url token (`url(/* c *\/"x")`) is invalid CSS that no browser fetches,
 * but the scanner and a browser must not disagree about it silently, so it is
 * reported rather than ignored.
 *
 * @param {string} css
 * @returns {{ urls: string[], malformed: boolean }}
 */
function cssUrls(css) {
  // Every fetching construct needs a literal `(` or `@`, which no escape can
  // supply, so a value without either cannot contain one. This only avoids
  // tokenizing large `d` and base64 attribute values for nothing.
  if (!/[(@]/.test(css)) return { urls: [], malformed: false };

  const tokens = [];
  tokenize(css, (type, start, end) => {
    if (type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment) {
      tokens.push({ type, text: css.slice(start, end), start, end });
    }
  });

  const urls = [];
  let malformed = false;
  const add = (value) => urls.push(value);

  for (let index = 0; index < tokens.length; index += 1) {
    const { type, text } = tokens[index];

    if (type === tokenTypes.Url) {
      add(url.decode(text));
    } else if (type === tokenTypes.BadUrl) {
      malformed = true;
    } else if (type === tokenTypes.Function) {
      const name = ident.decode(text.slice(0, -1)).toLowerCase();
      if (!URL_STRING_FUNCTIONS.has(name)) continue;
      // An escaped name (`\75rl(`) is still `url(` to a browser, which then
      // reads an unquoted argument as a url token the tokenizer did not build.
      if (
        name === 'url' &&
        text.toLowerCase() !== 'url(' &&
        tokens[index + 1]?.type !== tokenTypes.String
      ) {
        const close = css.indexOf(')', tokens[index].end);
        const raw = css.slice(
          tokens[index].end,
          close < 0 ? css.length : close,
        );
        add(url.decode(`url(${raw.trim()})`));
        continue;
      }
      let nesting = 1;
      for (let next = index + 1; next < tokens.length && nesting; next += 1) {
        const token = tokens[next];
        if (
          token.type === tokenTypes.Function ||
          token.type === tokenTypes.LeftParenthesis
        ) {
          nesting += 1;
        } else if (token.type === tokenTypes.RightParenthesis) {
          nesting -= 1;
        } else if (token.type === tokenTypes.String) {
          add(string.decode(token.text));
        }
      }
    } else if (
      type === tokenTypes.AtKeyword &&
      ident.decode(text.slice(1)).toLowerCase() === 'import' &&
      tokens[index + 1]?.type === tokenTypes.String
    ) {
      add(string.decode(tokens[index + 1].text));
    }
  }
  return { urls, malformed };
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
  const { events, errors } = parseXml(String(source));
  const findings = new Set();

  for (const error of errors.slice(0, 1)) findings.add(notWellFormed(error));

  const report = (css, subject) => {
    const { urls, malformed } = cssUrls(css);
    for (const target of urls.map(remoteTarget).filter(Boolean)) {
      findings.add(
        `references a remote resource in ${subject}: ${describeTarget(target)}`,
      );
    }
    if (malformed) {
      findings.add(`contains a malformed url() token in ${subject}`);
    }
  };

  for (const event of events) {
    if (event.type !== 'open') continue;
    const element = localName(event.name);

    for (const { name: rawName, value } of event.attributes) {
      const name = localName(rawName);
      const label = rawName.toLowerCase();

      // `src`, `srcset`, `action` and the like are not on the attribute
      // allowlist at all, so findActiveContent() rejects them whatever their
      // value; only `href` is both allowed and fetched.
      if (name === 'href' && !NAVIGATION_ELEMENTS.has(element)) {
        const target = remoteTarget(value);
        if (target) {
          findings.add(
            `references a remote resource in <${element}> ${label}: ${describeTarget(target)}`,
          );
        }
        continue;
      }

      // Every attribute value, not just `style`. SVG presentation attributes
      // (`fill`, `filter`, `mask`, `clip-path`, `marker-*`, ...) take the same
      // `url(...)` syntax as the CSS property of the same name, so
      // `fill="url(https://evil.example/x.svg#g)"` is the identical remote
      // fetch as `style="fill:url(https://evil.example/x.svg#g)"`.
      report(
        value,
        name === 'style'
          ? 'a style attribute'
          : `a ${label} presentation attribute`,
      );
    }
  }

  for (const { css } of styleBlocks(events)) report(css, 'a <style> block');

  return [...findings].sort();
}

function notWellFormed(message) {
  return `is not well-formed XML (${message}); this scan cannot see what a browser would parse`;
}

/**
 * Report whether `source` carries a DOCTYPE declaration.
 *
 * A document the XML parser rejects falls back to a text test for the
 * declaration, so a malformed one (an unclosed internal subset, say) is
 * reported rather than missed. That can over-report a comment that merely
 * mentions it, which only ever fails closed.
 *
 * @param {string} source - SVG file contents.
 * @returns {boolean}
 */
export function hasDoctype(source) {
  const text = String(source);
  const { events, errors } = parseXml(text);
  return (
    events.some((event) => event.type === 'doctype') ||
    (errors.length > 0 && /<!DOCTYPE/i.test(text))
  );
}

/**
 * Remove the DOCTYPE declaration from `source`, internal subset included.
 *
 * Callers strip the DOCTYPE because it is unnecessary in an SVG image and
 * breaks some XML consumers. The document is parsed and rebuilt without it, so
 * the removal cannot leave half a declaration behind or splice neighbouring
 * text into new markup.
 *
 * A document that is not well-formed is deliberately returned unchanged rather
 * than guessed at. Callers that publish the result must re-check hasDoctype()
 * and fail closed instead of reporting the strip as done.
 *
 * @param {string} source - SVG file contents.
 * @returns {string}
 */
export function stripDoctype(source) {
  const text = String(source);
  const { events, errors } = parseXml(text);
  if (errors.length || !events.some((event) => event.type === 'doctype')) {
    return text;
  }
  return rebuild(text, events, { dropDoctype: true }).source;
}

/**
 * Report the findings that make a document unsafe to edit rather than merely
 * unsafe to publish: the scan itself is blind to them.
 *
 * @param {string} source
 * @param {{ events: object[], errors: string[] }} parsed
 * @returns {string[]}
 */
function structuralFindings(source, { events, errors }) {
  // One finding is enough to reject the file, and a parser that has lost its
  // place reports a cascade that buries the cause.
  const findings = errors.slice(0, 1).map(notWellFormed);

  // An XML parser expands author-defined general entities before the document
  // tree exists, so a payload moved into a declaration is invisible to every
  // value-based check below: `<!ENTITY x "javascript:alert(1)">` paired with
  // `href="&x;"` reaches the browser as a script URI, while this scanner sees
  // only the undecodable reference `&x;`. Resolving them would mean
  // implementing entity expansion, and its recursion limits, inside a scanner;
  // failing closed costs nothing, because an SVG image has no reason to define
  // entities at all.
  if (
    events.some(
      (event) => event.type === 'doctype' && /<!ENTITY\s/i.test(event.value),
    )
  ) {
    findings.push(
      'contains an entity declaration in an internal DTD subset ' +
        '(the XML parser expands it, so its payload is not visible here)',
    );
  }

  // A file this module could not read faithfully cannot be vouched for: every
  // check ran against a string a browser never sees.
  if (MISDECODED_CHARACTER.test(source)) {
    findings.push(
      'contains NUL or replacement characters ' +
        '(the file is not UTF-8, so this scan did not see what a browser decodes)',
    );
  }

  const declaration = events.find((event) => event.type === 'pi');
  if (declaration?.name.toLowerCase() === 'xml') {
    const declared = declaration.body.match(
      /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
    );
    if (declared) {
      const encoding = (declared[1] ?? declared[2]).trim().toLowerCase();
      if (
        !SAFE_ENCODINGS.has(encoding) &&
        !SINGLE_BYTE_ASCII_ENCODING.test(encoding)
      ) {
        findings.push(
          `declares a non-UTF-8 encoding (${encoding || 'empty'}) ` +
            '(an XML parser honoring it reads different bytes than this scan did)',
        );
      }
    }
  }

  return findings;
}

/** URLs in an SVG may also embed a raster image as a `data:` URI. */
const RASTER = { rasterData: true };

/**
 * Whether an element is on the allowlist, by namespace and local name.
 *
 * @param {{ uri: string, local: string }} element
 * @returns {boolean}
 */
function elementAllowed({ uri, local }) {
  if (uri === SVG_NS) return SVG_ELEMENTS.has(local);
  if (uri === XHTML_NS) return XHTML_ELEMENTS.has(local);
  return METADATA_NAMESPACES.has(uri);
}

/**
 * Whether an attribute is on the allowlist for the element carrying it.
 *
 * A namespace declaration is an attribute too: it may only bind a namespace
 * this module knows, so no element or attribute can be moved into MathML,
 * XSLT, XML Events or a namespace a future browser gives meaning to.
 *
 * @param {{ uri: string }} element
 * @param {{ uri: string, local: string, value: string }} attribute
 * @returns {boolean}
 */
function attributeAllowed(element, { uri, local, value }) {
  if (uri === XMLNS_NS) return NAMESPACES.has(value);
  if (uri === XLINK_NS) return XLINK_ATTRIBUTES.has(local);
  if (uri === XML_NS) return XML_ATTRIBUTES.has(local);
  if (uri !== '') return METADATA_NAMESPACES.has(uri);
  if (DATA_ATTRIBUTE.test(local)) return true;
  if (element.uri === SVG_NS) {
    return (
      SVG_ATTRIBUTES.has(local) ||
      (element.local === 'svg' && SVG_ROOT_ATTRIBUTES.has(local))
    );
  }
  if (element.uri === XHTML_NS) return XHTML_ATTRIBUTES.has(local);
  return METADATA_ATTRIBUTES.has(local);
}

/**
 * The first URL in a {@link cssUrls} result whose scheme is not on the
 * allowlist, or null. A malformed url() token counts: no browser fetches one
 * today, but this scan cannot say what it names, so it is not vouched for.
 *
 * @param {{ urls: string[], malformed: boolean }} css
 * @returns {string|null}
 */
function firstDisallowed({ urls, malformed }) {
  if (malformed) return 'malformed url()';
  for (const value of urls) {
    const scheme = disallowedScheme(value, RASTER);
    if (scheme) return scheme;
  }
  return null;
}

/**
 * Classify one element start tag against the allowlist.
 *
 * An attribute fails either by name or by value. Two kinds of value are URLs a
 * browser follows or fetches: an `href` (plain or `xlink:`), and a CSS
 * `url()` in any attribute value -- SVG presentation attributes (`fill`,
 * `filter`, `mask`, `clip-path`, `marker-*`, ...) take the same `url(...)`
 * syntax as the CSS property of the same name.
 *
 * @param {object} event - An `open` event.
 * @returns {{ allowed: boolean, attributes: Array<{ finding: string, removal: string } | null> }}
 */
function classifyTag(event) {
  const attributes = event.attributes.map((attribute) => {
    const { name, value, local } = attribute;
    if (!attributeAllowed(event, attribute)) {
      return {
        finding: `a disallowed attribute ${name} on <${event.name}>`,
        removal: `${name} attribute`,
      };
    }
    const css = cssUrls(value);
    const scheme = firstDisallowed({
      ...css,
      urls: local === 'href' ? [value, ...css.urls] : css.urls,
    });
    return scheme
      ? {
          finding: `a disallowed URI scheme in ${name} on <${event.name}>: ${scheme}`,
          removal: `${name} attribute (${scheme})`,
        }
      : null;
  });
  return { allowed: elementAllowed(event), attributes };
}

/**
 * The `<style>` elements whose CSS fetches a URL with a disallowed scheme,
 * mapped to that scheme.
 *
 * @param {object[]} events
 * @returns {Map<object, string>}
 */
function disallowedStyles(events) {
  const styles = new Map();
  for (const { event, css } of styleBlocks(events)) {
    const scheme = firstDisallowed(cssUrls(css));
    if (scheme) styles.set(event, scheme);
  }
  return styles;
}

/**
 * Describe everything in an SVG source string that is not on the allowlist.
 * @param {string} source - SVG file contents.
 * @returns {string[]} Human-readable descriptions, empty when the SVG is inert.
 */
export function findActiveContent(source) {
  const text = String(source);
  const parsed = parseXml(text);
  const findings = structuralFindings(text, parsed);
  const instructions = new Set();
  const content = new Set();
  const styles = disallowedStyles(parsed.events);

  for (const event of parsed.events) {
    if (event.type === 'pi' && event.name.toLowerCase() !== 'xml') {
      instructions.add(event.name.toLowerCase() || '(unnamed)');
    }
    if (event.type !== 'open') continue;

    const tag = classifyTag(event);
    // A disallowed element is removed with its attributes, so they are not
    // findings of their own.
    if (!tag.allowed) {
      content.add(
        `contains a disallowed element <${event.name}>` +
          (event.uri === SVG_NS ? '' : ` (namespace ${event.uri || 'none'})`),
      );
      continue;
    }
    for (const attribute of tag.attributes) {
      if (attribute) content.add(`contains ${attribute.finding}`);
    }
    if (styles.has(event)) {
      content.add(
        `contains a disallowed URI scheme in a <style> block: ${styles.get(event)}`,
      );
    }
  }

  // The XML declaration is the only processing instruction an SVG image
  // legitimately carries. Anything else is at best a remote fetch and at worst
  // code: `<?xml-stylesheet href="https://evil.example/x.css"?>` makes the
  // browser fetch a third-party stylesheet, and a `type="text/xsl"` target
  // applies an XSLT program to the document.
  for (const target of [...instructions].sort()) {
    findings.push(
      `contains a <?${target}?> processing instruction ` +
        '(can load a remote stylesheet or apply an XSLT program to the image)',
    );
  }
  findings.push(...content);
  return findings;
}

const escapeText = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttribute = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');

/**
 * Serialize the parsed document back to XML, minus whatever is being removed.
 *
 * Rebuilding from the parse, instead of deleting character ranges from the
 * source, is what makes removal safe: nothing is ever spliced, so deleting an
 * element cannot join the text either side of it into a new element, and the
 * output is well-formed by construction.
 *
 * @param {string} source - Original text, for its BOM and trailing newline.
 * @param {object[]} events - Parse of `source`.
 * @param {{ dropDoctype?: boolean, strip?: boolean }} options
 * @returns {{ source: string, removed: string[] }}
 */
function rebuild(source, events, { dropDoctype = false, strip = false } = {}) {
  const removed = [];
  const styles = strip ? disallowedStyles(events) : new Map();
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  let output = bom;
  let skipDepth = null;
  const selfClosing = [];

  // Top-level nodes (declaration, DOCTYPE, comments, the root) go on their own
  // lines; the whitespace between them is not content and the parse drops it.
  const emit = (depth, text) => {
    if (depth === 0 && output.length > bom.length && !output.endsWith('\n')) {
      output += '\n';
    }
    output += text;
  };

  for (const event of events) {
    if (skipDepth !== null) {
      if (event.type === 'close' && event.depth === skipDepth) skipDepth = null;
      continue;
    }

    if (event.type === 'open') {
      const tag = strip ? classifyTag(event) : null;
      if (tag && (!tag.allowed || styles.has(event))) {
        removed.push(
          tag.allowed
            ? `<${event.name}> element (${styles.get(event)})`
            : `<${event.name}> element`,
        );
        skipDepth = event.depth;
        continue;
      }
      const attributes = event.attributes
        .filter((_, index) => {
          const verdict = tag?.attributes[index];
          if (verdict) removed.push(verdict.removal);
          return !verdict;
        })
        .map(({ name, value }) => ` ${name}="${escapeAttribute(value)}"`)
        .join('');
      selfClosing.push(event.selfClosing);
      emit(
        event.depth,
        `<${event.name}${attributes}${event.selfClosing ? '/>' : '>'}`,
      );
    } else if (event.type === 'close') {
      if (!selfClosing.pop()) output += `</${event.name}>`;
    } else if (event.type === 'text') {
      // Whitespace outside the root is layout, not content.
      if (event.depth > 0) output += escapeText(event.value);
    } else if (event.type === 'cdata') {
      output += `<![CDATA[${event.value}]]>`;
    } else if (event.type === 'comment') {
      emit(event.depth, `<!--${event.value}-->`);
    } else if (event.type === 'doctype') {
      if (!dropDoctype) emit(event.depth, `<!DOCTYPE${event.value}>`);
    } else if (event.type === 'pi') {
      if (event.name.toLowerCase() === 'xml') {
        emit(event.depth, `<?xml ${event.body}?>`);
      } else if (strip) {
        removed.push(
          `<?${event.name.toLowerCase() || '(unnamed)'}?> processing instruction`,
        );
      } else {
        emit(event.depth, `<?${event.name} ${event.body}?>`);
      }
    }
  }

  if (source.endsWith('\n')) output += '\n';
  return { source: output, removed };
}

/**
 * Remove everything that is not on the allowlist from an SVG source string.
 *
 * Removes each disallowed element together with its subtree, and each
 * `<style>` element whose CSS fetches a disallowed scheme; drops each
 * disallowed attribute, and each allowed one whose URL has a disallowed
 * scheme; and leaves allowed markup untouched. A source with nothing to remove is
 * returned byte for byte; otherwise the document is rebuilt from its parse
 * (see {@link rebuild}).
 *
 * The result is re-scanned before it is returned. Callers write it to the
 * site origin verbatim, so a source the detector still flags must never be
 * handed back as sanitized.
 *
 * @param {string} source - SVG file contents.
 * @param {Object} [options]
 * @param {(source: string) => string[]} [options.scan] - Detector run over
 *   the rebuilt output. Defaults to {@link findActiveContent}; the override
 *   exists so the survival throw below can be exercised, because the default
 *   detector and the stripper agree by construction today.
 * @returns {{ source: string, removed: string[] }}
 * @throws {Error} If the document cannot be edited safely or active content
 *   survives. A document that is not well-formed, declares entities, or is
 *   mis-decoded throws by design: there is no safe edit to bytes this module
 *   cannot read the way a browser does, and silently repairing a document
 *   whose payload it cannot see would be the opposite of what the
 *   verification is for.
 */
export function stripActiveContent(source, { scan = findActiveContent } = {}) {
  const text = String(source);
  const findings = findActiveContent(text);
  if (!findings.length) return { source: text, removed: [] };

  const parsed = parseXml(text);
  const blocking = structuralFindings(text, parsed);
  if (blocking.length) {
    throw new Error(
      `Could not strip active content from SVG: ${findings.join('; ')}`,
    );
  }

  // Findings and removals both come from classifyTag() over this same parse,
  // and the output is serialized from the tree, so what is left should be
  // exactly the nodes that produced no finding. That is an argument about two
  // code paths agreeing, not a property of the bytes being returned, and the
  // bytes are what callers publish at the site origin: architecture-content.mjs
  // and enduser-collector.mjs write this string into static/ with no active
  // content check of their own. Re-scan the actual output so any future
  // divergence between classifyTag()'s removal set, rebuild()'s serialization
  // and findActiveContent()'s detection fails closed here instead of
  // publishing a document that only looks sanitized.
  const result = rebuild(text, parsed.events, { strip: true });
  const residual = scan(result.source);
  if (residual.length) {
    throw new Error(
      `Active content survived stripping from SVG: ${residual.join('; ')}`,
    );
  }
  return result;
}
