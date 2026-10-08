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
 * A DOCTYPE declaration, internal subset included.
 *
 * `<!DOCTYPE\s[^>]*>` cannot express this: the first `>` inside an internal
 * subset closes an `<!ENTITY ...>` declaration, not the DOCTYPE, so that
 * pattern deletes the declaration and leaves a bare `]>` behind -- in a file
 * the caller then publishes as well-formed XML.
 *
 * Quoted literals need the same care. An ExternalID's system identifier may
 * contain `[`, `]` or `>` (`<!DOCTYPE svg SYSTEM "https://h/x[.dtd">`), so a
 * pattern that reads a bare `[` as the start of an internal subset either
 * matches nothing -- returning the declaration to a caller that reports it
 * removed -- or swallows everything up to an unrelated `]>` such as the end
 * of a CDATA section. Each alternation branch below therefore consumes a
 * quoted literal through its closing mate before the structural characters
 * `[`, `]` and `>` are given any meaning. The branches are disjoint on their
 * first character, so matching stays linear.
 *
 * A DOCTYPE whose subset or quoted literal never closes matches nothing and
 * is left in place. Callers must treat that as a failed strip: check
 * hasDoctype() on the result and refuse to publish, rather than assume the
 * replacement succeeded.
 */
const DOCTYPE_PATTERN =
  /<!DOCTYPE\s(?:[^[>"']|"[^"]*"|'[^']*')*(?:\[(?:[^\]"']|"[^"]*"|'[^']*')*\]\s*)?>\s*/gi;

/** An entity declaration, which only appears inside an internal DTD subset. */
const ENTITY_DECLARATION = /<!ENTITY\s/i;

/**
 * An XML processing instruction, target captured.
 *
 * The only PI an SVG image legitimately carries is the XML declaration
 * `<?xml ...?>`. Anything else is at best a remote fetch and at worst code:
 * `<?xml-stylesheet href="https://evil.example/x.css"?>` makes the browser
 * fetch a third-party stylesheet when the SVG is opened directly, and a
 * `type="text/xsl"` target applies an XSLT program to the document. Start-tag
 * and attribute scanning never sees either, because a PI is not a tag.
 */
const PROCESSING_INSTRUCTION = /<\?([^\s?>]*)[\s\S]*?\?>/g;

/**
 * Characters that only appear when a file was decoded with the wrong charset.
 *
 * The validators read every SVG as UTF-8. A UTF-16 file read that way turns
 * into NUL-riddled text (or U+FFFD replacements where the bytes are not valid
 * UTF-8 at all), and every regex in this module then scans a string that is
 * not what a browser honoring the BOM or `encoding=` declaration parses. The
 * mismatch is the finding: this scanner cannot vouch for bytes it cannot read.
 */
// eslint-disable-next-line no-control-regex
const MISDECODED_CHARACTER = /[\u0000\ufffd]/;

/**
 * The encoding pseudo-attribute of an XML declaration at the start of the
 * document. Encodings that are not a UTF-8 subset shift byte interpretation
 * away from what this module's UTF-8 reading saw.
 */
const XML_DECLARATION_ENCODING =
  /^\uFEFF?\s*<\?xml\b[^?]*\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

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
 * Report whether `source` carries a DOCTYPE declaration.
 *
 * @param {string} source - SVG file contents.
 * @returns {boolean}
 */
export function hasDoctype(source) {
  return /<!DOCTYPE\s/i.test(String(source));
}

/**
 * Remove every DOCTYPE declaration from `source`, internal subset included.
 *
 * Callers strip the DOCTYPE because it is unnecessary in an SVG image and
 * breaks some XML consumers. Removing only the part before the subset's first
 * `>` leaves markup that is neither a DOCTYPE nor valid content, so the single
 * pattern lives here and every caller shares it.
 *
 * A malformed declaration (unclosed subset or quoted literal) is deliberately
 * left in place rather than guessed at. Callers that publish the result must
 * re-check hasDoctype() and fail closed instead of reporting the strip as
 * done.
 *
 * @param {string} source - SVG file contents.
 * @returns {string}
 */
export function stripDoctype(source) {
  return String(source).replace(DOCTYPE_PATTERN, '');
}

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

const STYLE_OPEN_TAG = new RegExp(
  `<\\s*${NS_PREFIX}style\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>`,
  'gi',
);

/** Sticky, so the close tag can be tested in place without slicing. */
const STYLE_CLOSE_TAG = new RegExp(`<\\s*/\\s*${NS_PREFIX}style\\s*>`, 'iy');

const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';

/**
 * The CSS text of every `<style>` element in `source`.
 *
 * A single lazy `<style ...>([\s\S]*?)</style>` regex cannot express this. In
 * XML -- which is how a browser parses a standalone `.svg` -- a `</style>`
 * inside a CDATA section is ordinary character data, so it does not close the
 * element; the lazy match stops there anyway and every declaration after it
 * goes unscanned, in a file that is well-formed and renders. That hid a live
 * `url(https://host/...)` fetch from findRemoteReferences, which is the gate
 * that keeps a visitor's IP, User-Agent and Referer from reaching a host the
 * diagram's author chose.
 *
 * CDATA sections are therefore consumed whole before `<` is given any
 * meaning. A `<style>` that never closes is read to the end of the document:
 * that is what an HTML parser does, and in XML it is a fatal error, so
 * scanning the remainder is the conservative reading under either grammar.
 * A self-closing `<style/>` has no content and is skipped.
 *
 * @param {string} source - SVG file contents.
 * @returns {string[]}
 */
function styleBlockContents(source) {
  const blocks = [];
  STYLE_OPEN_TAG.lastIndex = 0;
  let open;
  while ((open = STYLE_OPEN_TAG.exec(source))) {
    const contentStart = open.index + open[0].length;
    if ((open[1] ?? '').trimEnd().endsWith('/')) {
      STYLE_OPEN_TAG.lastIndex = contentStart;
      continue;
    }

    let cursor = contentStart;
    let contentEnd = -1;
    while (cursor < source.length) {
      if (source.startsWith(CDATA_OPEN, cursor)) {
        const close = source.indexOf(CDATA_CLOSE, cursor + CDATA_OPEN.length);
        cursor = close === -1 ? source.length : close + CDATA_CLOSE.length;
        continue;
      }
      if (source[cursor] === '<') {
        STYLE_CLOSE_TAG.lastIndex = cursor;
        if (STYLE_CLOSE_TAG.test(source)) {
          contentEnd = cursor;
          break;
        }
      }
      cursor += 1;
    }

    const end = contentEnd === -1 ? source.length : contentEnd;
    blocks.push(source.slice(contentStart, end));
    STYLE_OPEN_TAG.lastIndex = end;
  }
  return blocks;
}

/**
 * A CSS escape sequence: a hex escape of one to six digits with the single
 * optional whitespace character that terminates it, a backslash-newline line
 * continuation, or a backslash before any other single character.
 */
const CSS_ESCAPE_PATTERN =
  /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \n\r\t\f])?|(\r\n|[\n\r\f])|([\s\S]))/gi;

/**
 * Decode the CSS escape sequences in a url token or string.
 *
 * A browser's CSS tokenizer resolves escapes before the value is ever read as
 * a URL, so `url(\68ttps://evil.example/x.css)` fetches
 * `https://evil.example/x.css`. Scanning the raw text instead sees a value
 * starting with a backslash, which is neither absolute nor protocol-relative,
 * and the remote fetch walks past findRemoteReferences -- the gate that keeps
 * a visitor's IP, User-Agent and Referer from reaching a host the diagram's
 * author chose. Every escapable character is reachable this way, so no
 * substring test on the undecoded value can stand in for decoding.
 *
 * This is CSS syntax only. Attribute values that are URLs rather than CSS keep
 * a backslash's URL meaning, which remoteTarget already handles, so decoding
 * stays scoped to the CSS callers.
 *
 * @param {string} value - Raw CSS url token or string contents.
 * @returns {string}
 */
function decodeCssEscapes(value) {
  return String(value).replace(
    CSS_ESCAPE_PATTERN,
    (match, hex, newline, literal) => {
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        // CSS maps NUL, the surrogate range and out-of-range code points to
        // U+FFFD rather than to the character the digits name.
        return code === 0 ||
          code > 0x10ffff ||
          (code >= 0xd800 && code <= 0xdfff)
          ? '\ufffd'
          : String.fromCodePoint(code);
      }
      // A backslash-newline inside a string is a line continuation: it
      // contributes nothing, so the text either side joins up.
      return newline !== undefined ? '' : literal;
    },
  );
}

/**
 * A CSS `url(...)` target, quoted or bare. Covers `@font-face` `src` too.
 *
 * The bare branch spells out escape sequences rather than stopping at the
 * first whitespace, because the whitespace that terminates a hex escape
 * belongs to the escape: `url(\000068 ttps://evil.example/x.css)` is one url
 * token whose value is `https://evil.example/x.css`, and a `[^)\s"']*` read
 * would capture only `\000068` and lose the host entirely.
 *
 * The alternatives inside the bare branch are mutually exclusive on purpose.
 * A single `\\[0-9a-f]{1,6}` alternative lets a hex run split across branches
 * — `\abcdef` as `\abcde` plus a bare `f`, and so on — so an unterminated
 * `url(` followed by repeated escapes backtracks exponentially (about 7x per
 * repetition). findRemoteReferences runs on third-party SVGs, so that is a
 * hang an upstream diagram can trigger. Splitting the hex run into a full
 * six-digit form and a shorter form guarded by `(?![0-9a-f])`, and excluding
 * hex digits from the single-character escape, leaves exactly one way to match
 * any input and keeps the scan linear.
 */
const CSS_URL_PATTERN =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|((?:\\[0-9a-f]{6}[ \n\r\t\f]?|\\[0-9a-f]{1,5}(?![0-9a-f])[ \n\r\t\f]?|\\[^0-9a-f]|[^)\s"'\\])*))\s*\)/gi;

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
 * The opening of an `image-set()` argument list, `-webkit-` alias included.
 *
 * CSS Images 4 gives `image-set()` a second spelling for its image reference:
 * `<image-set-option> = [ <image> | <string> ] ...`, and "each `<string>`
 * inside `image-set()` represents a `<url>`". So
 * `image-set("https://evil.example/x.png" 1x)` is a live remote fetch that
 * carries no `url(` token for CSS_URL_PATTERN to find and no `@import` for
 * CSS_IMPORT_PATTERN -- the same shape of gap CSS_IMPORT_PATTERN exists to
 * close. `image-set()` is accepted wherever an `<image>` is (`cursor`,
 * `background-image`, `mask-image`, `list-style-image`), and `cursor` and
 * `mask-image` are not `img-src` fetch directives, so the meta CSP does not
 * stand in for this check.
 *
 * Only the opening is a pattern. The argument list is walked by
 * {@link imageSetTargets} rather than matched, because a nested
 * `url(...)`/`type(...)` means the closing parenthesis cannot be found by a
 * regex without either stopping early or backtracking.
 */
const IMAGE_SET_OPEN = /(?:-webkit-)?image-set\(/gi;

/** A quoted CSS string, matched as a unit so its contents stay opaque. */
const CSS_STRING = /"([^"]*)"|'([^']*)'/g;

/**
 * The bare-string arguments of every `image-set()` in a fragment of CSS.
 *
 * The argument list is walked with a parenthesis depth counter, skipping
 * quoted strings so a parenthesis inside one cannot close the list early. An
 * `image-set(` that never closes is read to the end of the fragment, which is
 * the fail-closed reading: a target hidden behind a missing parenthesis is
 * still reported. Strings belonging to a nested `url("...")` are collected
 * too; that only duplicates what CSS_URL_PATTERN already found, and
 * findRemoteReferences collects into a Set. A `type("image/png")` string is
 * collected and then discarded by remoteTarget(), which no media type
 * satisfies.
 *
 * @param {string} css
 * @returns {string[]} Raw string contents, still CSS-escaped.
 */
function imageSetArguments(css) {
  const values = [];
  IMAGE_SET_OPEN.lastIndex = 0;
  let open;
  while ((open = IMAGE_SET_OPEN.exec(css))) {
    let cursor = open.index + open[0].length;
    let depth = 1;
    const start = cursor;
    while (cursor < css.length && depth > 0) {
      const char = css[cursor];
      if (char === '"' || char === "'") {
        const close = css.indexOf(char, cursor + 1);
        cursor = close === -1 ? css.length : close + 1;
        continue;
      }
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      cursor += 1;
    }
    const end = depth === 0 ? cursor - 1 : css.length;
    const args = css.slice(start, end);
    CSS_STRING.lastIndex = 0;
    for (const string of args.matchAll(CSS_STRING)) {
      values.push(string[1] ?? string[2]);
    }
    IMAGE_SET_OPEN.lastIndex = end;
  }
  return values;
}

/**
 * Remove CSS comments, which a browser's tokenizer discards before any value
 * is read. A comment placed between `url(` and its quoted argument, or
 * between `@import` and its string, still fetches, while the raw text matches
 * neither CSS_URL_PATTERN nor CSS_IMPORT_PATTERN.
 *
 * Quoted strings are skipped: a comment opener inside a CSS string is two
 * literal characters, not the start of a comment, and treating it as one
 * would swallow the rest of the stylesheet -- hiding every later `url()` from
 * the scan, which is the opposite of what this gate is for. An unterminated
 * comment runs to the end of the fragment, as the tokenizer does.
 *
 * Each comment is replaced by a single space rather than deleted. A comment
 * separates tokens, so deleting it would fuse the text either side and
 * manufacture a token the browser never sees: a comment inserted into the
 * middle of the letters of `url(` does not leave a `url(` behind.
 *
 * @param {string} css
 * @returns {string}
 */
function stripCssComments(css) {
  let output = '';
  let cursor = 0;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === '"' || char === "'") {
      const close = css.indexOf(char, cursor + 1);
      const end = close === -1 ? css.length : close + 1;
      output += css.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (char === '/' && css[cursor + 1] === '*') {
      const close = css.indexOf('*/', cursor + 2);
      cursor = close === -1 ? css.length : close + 2;
      output += ' ';
      continue;
    }
    output += char;
    cursor += 1;
  }
  return output;
}

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
  // The URL parser treats `\` as `/` in the scheme and authority prefix of a
  // special-scheme URL, and the site is served over https, so every relative
  // reference resolves against a special-scheme base. `\\host`, `/\host`,
  // `\/host` and `https:\\host` therefore reach `host` exactly as `//host`
  // does, while a `//`-only test reads all four as same-origin paths.
  //
  // Only the leading run of separators is translated. A single separator
  // keeps the value on this origin (`\host` is the path `/host`, and
  // `https:/host` likewise), and an interior backslash is an ordinary path
  // character -- `./sub\dir/x.png` must stay local, not become a host.
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

  for (const block of styleBlockContents(String(source))) {
    for (const target of cssTargets(block)) {
      findings.add(
        `references a remote resource in a <style> block: ${describeTarget(target)}`,
      );
    }
  }

  return [...findings].sort();
}

/**
 * Collect the remote targets in a fragment of CSS, from the `url(...)` token,
 * the bare-string `@import` form and the bare-string `image-set()` form.
 *
 * Comments are removed first, because a browser's tokenizer discards them
 * before any of these three constructs is read.
 * @param {string} css
 * @returns {string[]}
 */
function cssTargets(css) {
  const targets = [];
  const normalized = stripCssComments(String(css));
  for (const pattern of [CSS_URL_PATTERN, CSS_IMPORT_PATTERN]) {
    for (const match of normalized.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];
      const target = remoteTarget(decodeCssEscapes(value));
      if (target) targets.push(target);
    }
  }
  for (const value of imageSetArguments(normalized)) {
    const target = remoteTarget(decodeCssEscapes(value));
    if (target) targets.push(target);
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

  // An XML parser expands author-defined general entities before the document
  // tree exists, so a payload moved into a declaration is invisible to every
  // value-based check below: `<!ENTITY x "javascript:alert(1)">` paired with
  // `href="&x;"` reaches the browser as a script URI, while this scanner sees
  // only the undecodable reference `&x;`. Resolving them would mean
  // implementing entity expansion, and its recursion limits, inside a scanner;
  // failing closed costs nothing, because an SVG image has no reason to define
  // entities at all.
  if (ENTITY_DECLARATION.test(source)) {
    findings.push(
      'contains an entity declaration in an internal DTD subset ' +
        '(the XML parser expands it, so its payload is not visible here)',
    );
  }

  // A file this module could not read faithfully cannot be vouched for: every
  // check below ran against a string a browser never sees. Fail closed rather
  // than certify bytes the scanner did not actually scan.
  if (MISDECODED_CHARACTER.test(source)) {
    findings.push(
      'contains NUL or replacement characters ' +
        '(the file is not UTF-8, so this scan did not see what a browser decodes)',
    );
  }
  const declaredEncoding = String(source).match(XML_DECLARATION_ENCODING);
  if (declaredEncoding) {
    const encoding = (declaredEncoding[1] ?? declaredEncoding[2])
      .trim()
      .toLowerCase();
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

  const instructions = new Set();
  for (const match of String(source).matchAll(PROCESSING_INSTRUCTION)) {
    const target = match[1].toLowerCase();
    if (target !== 'xml') {
      instructions.add(target || '(unnamed)');
    }
  }
  for (const target of [...instructions].sort()) {
    findings.push(
      `contains a <?${target}?> processing instruction ` +
        '(can load a remote stylesheet or apply an XSLT program to the image)',
    );
  }

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
 *   must never be handed back as sanitized. An entity declaration reaches this
 *   throw by design: nothing here removes a DOCTYPE, and silently repairing a
 *   document whose payload this module cannot read would be the opposite of
 *   what the verification is for. Mis-decoded input (NUL/replacement
 *   characters, a declared non-UTF-8 encoding) throws for the same reason:
 *   there is no safe edit to bytes the scanner could not faithfully read.
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

  output = output.replace(PROCESSING_INSTRUCTION, (match, target) => {
    const name = target.toLowerCase();
    if (name === 'xml') {
      return match;
    }
    removed.push(`<?${name || '(unnamed)'}?> processing instruction`);
    return '';
  });

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
