/**
 * Detection and removal of active (script-executing) content in SVG files.
 *
 * SVG is a document format, not just an image format. A browser that loads an
 * SVG directly (for example `/img/architectures/example/diagram.svg`) executes
 * any script it contains in the origin that served it. Assets imported from
 * third-party repositories therefore have to be treated as untrusted input.
 *
 * This module reads SVG the way a browser does: as XML, through a real XML
 * parser (`sax`, strict mode), and reads embedded CSS through the CSS Syntax
 * tokenizer (`css-tree`). Detection asks the resulting element and attribute
 * tree, and the resulting token stream, what they contain. It never pattern
 * matches over source text, so comments, CDATA sections, entity and character
 * references, CSS escapes and quote pairing are resolved by the parsers rather
 * than guessed at here.
 *
 * The scan fails closed. A document the XML parser rejects, or that declares
 * entities or a non-UTF-8 encoding, is itself a finding: this module cannot
 * vouch for bytes it cannot read the way a browser does.
 */

import sax from 'sax';
import { ident, string, tokenize, tokenTypes, url } from 'css-tree';
import { activeScheme, describeTarget, remoteTarget } from './uri-safety.mjs';

/**
 * Elements that execute or bind script, embed a separate document, or change
 * how the page resolves or leaves itself.
 *
 * `iframe`, `embed` and `object` are only reachable inside `<foreignObject>`,
 * where they load an attacker-chosen document into the origin serving the SVG.
 * `foreignObject` itself stays allowed: editors such as draw.io emit it for
 * ordinary text, and imported diagrams already rely on it. `base` re-points
 * every relative reference, and `meta` carries `http-equiv="refresh"`.
 */
const ACTIVE_ELEMENTS = new Set([
  'script',
  'handler',
  'listener',
  'iframe',
  'embed',
  'object',
  'base',
  'meta',
]);

/**
 * Attributes that carry a whole document as their value. `srcdoc` markup is
 * entity-encoded, so no scheme scan of the value would ever flag it; the
 * attribute name is the finding.
 */
const DOCUMENT_ATTRIBUTES = new Set(['srcdoc']);

/** Attributes whose value is a single URL the browser fetches. */
const FETCHED_ATTRIBUTES = new Set(['src', 'poster', 'background']);

/** `srcset` holds a list of candidates, each a URL and an optional descriptor. */
const SRCSET_ATTRIBUTE = 'srcset';

/**
 * Elements whose `href` is navigation the visitor chooses rather than a load
 * the page performs. draw.io exports legitimately carry such links, so
 * flagging them would fail the existing corpus. Every other element's `href`
 * is treated as a fetch: that fails closed for elements this module does not
 * enumerate (`use`, `image`, `feImage`, `filter`, `script`, `link`, `pattern`,
 * gradients, `textPath`, and whatever SVG adds next).
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

const PROLOG_DOCTYPE =
  /^[\s\uFEFF]*(?:<\?[^]*?\?>\s*|<!--[^]*?-->\s*)*<!DOCTYPE/i;

/**
 * Parse `source` as XML into a flat event list.
 *
 * `sax` is run in strict mode, with errors recorded and parsing resumed so a
 * malformed document still yields whatever it recovered: the scans below then
 * report both the malformation and anything active they can still see.
 * Namespace prefixes are deliberately not resolved. Every name is compared by
 * local name, whatever namespace it binds, because the prefix is arbitrary
 * (`<x:script xmlns:x="http://www.w3.org/2000/svg">` is a script element) and
 * a name that is only dangerous in one namespace is not worth distinguishing
 * in an image.
 *
 * @param {string} source - SVG file contents.
 * @returns {{ events: object[], errors: string[] }}
 */
function parseXml(source) {
  const events = [];
  const errors = [];
  const parser = sax.parser(true);
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
      attributes: Object.entries(tag.attributes),
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
    PROLOG_DOCTYPE.test(source)
  ) {
    errors.push('Unterminated DOCTYPE');
  }
  return { events, errors };
}

/**
 * The CSS text of every `<style>` element, in document order.
 *
 * The XML parser has already resolved CDATA sections and character references,
 * so a `</style>` inside CDATA is data and `&#117;rl(` is `url(`.
 *
 * @param {object[]} events
 * @returns {string[]}
 */
function styleBlocks(events) {
  const blocks = [];
  const open = [];
  for (const event of events) {
    if (event.type === 'open' && localName(event.name) === 'style') {
      open.push(blocks.length);
      blocks.push('');
    } else if (event.type === 'close' && localName(event.name) === 'style') {
      open.pop();
    } else if (
      (event.type === 'text' || event.type === 'cdata') &&
      open.length
    ) {
      blocks[open.at(-1)] += event.value;
    }
  }
  return blocks;
}

/**
 * Collect the remote targets in a fragment of CSS.
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
 * @returns {{ targets: string[], malformed: boolean }}
 */
function cssTargets(css) {
  // Every fetching construct needs a literal `(` or `@`, which no escape can
  // supply, so a value without either cannot contain one. This only avoids
  // tokenizing large `d` and base64 attribute values for nothing.
  if (!/[(@]/.test(css)) return { targets: [], malformed: false };

  const tokens = [];
  tokenize(css, (type, start, end) => {
    if (type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment) {
      tokens.push({ type, text: css.slice(start, end), start, end });
    }
  });

  const targets = [];
  let malformed = false;
  const add = (value) => {
    const target = remoteTarget(value);
    if (target) targets.push(target);
  };

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
  return { targets, malformed };
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
    const { targets, malformed } = cssTargets(css);
    for (const target of targets) {
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

    for (const [rawName, value] of event.attributes) {
      const name = localName(rawName);
      const label = rawName.toLowerCase();

      if (
        (name === 'href' && !NAVIGATION_ELEMENTS.has(element)) ||
        FETCHED_ATTRIBUTES.has(name)
      ) {
        const target = remoteTarget(value);
        if (target) {
          findings.add(
            `references a remote resource in <${element}> ${label}: ${describeTarget(target)}`,
          );
        }
        continue;
      }

      if (name === SRCSET_ATTRIBUTE) {
        for (const candidate of value.split(/[\s,]+/)) {
          const target = remoteTarget(candidate);
          if (target) {
            findings.add(
              `references a remote resource in <${element}> ${label}: ${describeTarget(target)}`,
            );
          }
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

  for (const block of styleBlocks(events)) report(block, 'a <style> block');

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

/**
 * Classify one element start tag.
 *
 * @param {object} event - An `open` event.
 * @returns {{ element: string|null, animated: boolean, attributes: Array<{ name: string, finding: string|null, removal: string|null, handler: boolean }> }}
 */
function classifyTag(event) {
  const local = localName(event.name);
  const attributes = event.attributes.map(([rawName, value]) => {
    const name = rawName.toLowerCase();
    const attribute = localName(rawName);

    if (/^on[a-z]+$/.test(attribute)) {
      return { name: attribute, kind: 'handler', removal: `${name} attribute` };
    }
    if (DOCUMENT_ATTRIBUTES.has(attribute)) {
      return {
        name,
        kind: 'document',
        removal: `${name} attribute (embedded document)`,
      };
    }
    const scheme = activeScheme(value);
    if (scheme) {
      return {
        name,
        kind: 'scheme',
        scheme,
        removal: `${name} attribute (${scheme})`,
      };
    }
    return { name, kind: null, removal: null };
  });

  // `<animate>`/`<set>` can assign a value to `href` at runtime, so an element
  // that is inert in the source becomes a javascript: link once the animation
  // begins. The element itself is the finding: its `to`/`values`/`from`
  // payloads are ordinary attribute values that no scheme scan would flag on
  // an element that is not itself a link.
  const animated =
    (local === 'animate' || local === 'set') &&
    event.attributes.some(
      ([rawName, value]) =>
        localName(rawName) === 'attributename' &&
        localName(value.trim()) === 'href',
    );

  return {
    element: ACTIVE_ELEMENTS.has(local) ? local : null,
    animated,
    attributes,
  };
}

/**
 * Describe every piece of active content found in an SVG source string.
 * @param {string} source - SVG file contents.
 * @returns {string[]} Human-readable descriptions, empty when the SVG is inert.
 */
export function findActiveContent(source) {
  const text = String(source);
  const parsed = parseXml(text);
  const findings = structuralFindings(text, parsed);

  const instructions = new Set();
  const elements = new Set();
  const handlers = new Set();
  const schemes = new Set();
  const documents = new Set();
  const animated = new Set();

  for (const event of parsed.events) {
    if (event.type === 'pi' && event.name.toLowerCase() !== 'xml') {
      instructions.add(event.name.toLowerCase() || '(unnamed)');
    }
    if (event.type !== 'open') continue;

    const tag = classifyTag(event);
    if (tag.element) elements.add(tag.element);
    if (tag.animated) animated.add(localName(event.name));
    for (const attribute of tag.attributes) {
      if (attribute.kind === 'handler') handlers.add(attribute.name);
      if (attribute.kind === 'document') documents.add(attribute.name);
      if (attribute.kind === 'scheme') {
        schemes.add(`${attribute.name}="${attribute.scheme}..."`);
      }
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
  for (const element of elements) {
    findings.push(`contains a <${element}> element`);
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
  for (const element of [...animated].sort()) {
    findings.push(
      `contains a <${element}> element that animates href (can install a script URI at runtime)`,
    );
  }

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
      const tag = classifyTag(event);
      if (strip && (tag.element || tag.animated)) {
        removed.push(
          tag.element
            ? `<${tag.element}> element`
            : `<${localName(event.name)}> element animating href`,
        );
        skipDepth = event.depth;
        continue;
      }
      const attributes = event.attributes
        .filter((_, index) => {
          const { removal } = tag.attributes[index];
          if (strip && removal) {
            removed.push(removal);
            return false;
          }
          return true;
        })
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
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
 * Remove active content from an SVG source string.
 *
 * Removes script-bearing elements outright and drops offending attributes
 * while leaving inert markup untouched. A source with nothing to remove is
 * returned byte for byte; otherwise the document is rebuilt from its parse
 * (see {@link rebuild}).
 *
 * The result is re-scanned before it is returned. Callers write it to the
 * site origin verbatim, so a source the detector still flags must never be
 * handed back as sanitized.
 *
 * @param {string} source - SVG file contents.
 * @returns {{ source: string, removed: string[] }}
 * @throws {Error} If the document cannot be edited safely or active content
 *   survives. A document that is not well-formed, declares entities, or is
 *   mis-decoded throws by design: there is no safe edit to bytes this module
 *   cannot read the way a browser does, and silently repairing a document
 *   whose payload it cannot see would be the opposite of what the
 *   verification is for.
 */
export function stripActiveContent(source) {
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
  // and the output is serialized from the tree, so what is left is exactly the
  // nodes that produced no finding.
  const result = rebuild(text, parsed.events, { strip: true });
  return result;
}
