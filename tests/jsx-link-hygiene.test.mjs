import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every JSX source under src/ is compiled by Docusaurus and shipped to the
// browser without any lint pass: the repository declares no eslint config, so
// `eslint-plugin-jsx-a11y` and `react/jsx-no-target-blank` never run. The three
// invariants below are therefore unguarded end to end.
//
//  - `target="_blank"` without `rel="noopener"`/`rel="noreferrer"` hands the
//    opened page a live `window.opener` handle back to this site (reverse
//    tabnabbing). Current browsers imply `noopener`, older ones do not.
//  - An `<img>` with no `alt` attribute at all makes a screen reader announce
//    the file name. `alt=""` is the correct, deliberate marking for decorative
//    images and is accepted here; a missing attribute is not.
//  - A literal `http://` href is a mixed-content downgrade on an https site.
//
// The scanner reads source text rather than a parsed tree so that no JSX
// transform or new dependency is required; it is written to handle the
// multi-line attribute lists and `{`-delimited expression values that this
// repository actually uses.

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Removes comments so that commented-out markup is never scanned as live JSX.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Returns the index just past the opening tag that starts at `start`, tracking
// quote and brace nesting so that a `>` inside an attribute value — common in
// template literals such as {`${a} — ${b}`} and in arrow functions — does not
// terminate the tag early. Returns -1 if the tag never closes.
function endOfOpeningTag(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return i + 1;
  }
  return -1;
}

// Collects every opening tag for the given element name. `<a>` must not match
// `<article>`, so the character after the name has to be whitespace, `/` or `>`.
function openingTags(source, name) {
  const tags = [];
  const pattern = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  for (const match of source.matchAll(pattern)) {
    const end = endOfOpeningTag(source, match.index);
    if (end !== -1) tags.push(source.slice(match.index, end));
  }
  return tags;
}

// Reads a string-literal attribute value. Attributes whose value is a JSX
// expression return null, because their value is not statically known.
function stringAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

function hasAttribute(tag, name) {
  return new RegExp(`\\s${name}\\s*=`).test(tag);
}

const sources = walk(srcDir).map((file) => ({
  file,
  path: relative(root, file),
  text: stripComments(readFileSync(file, 'utf8')),
}));

const anchors = sources.flatMap(({ path, text }) =>
  openingTags(text, 'a').map((tag) => ({ path, tag })),
);
const images = sources.flatMap(({ path, text }) =>
  openingTags(text, 'img').map((tag) => ({ path, tag })),
);

test('the JSX scan finds anchors and images, so the checks are not vacuous', () => {
  assert.ok(sources.length > 0, 'found no JSX sources under src/');
  assert.ok(
    anchors.length >= 10,
    `expected the src/ tree to yield many <a> tags, scanned ${anchors.length}`,
  );
  assert.ok(
    images.length >= 5,
    `expected the src/ tree to yield several <img> tags, scanned ${images.length}`,
  );
  // A scanner that stopped at the first `>` inside an attribute value would
  // return truncated tags, and every attribute assertion below would pass by
  // finding nothing. Every anchor in this repository carries an href.
  for (const { path, tag } of anchors) {
    assert.ok(
      hasAttribute(tag, 'href'),
      `${path}: scanned an <a> tag with no href, which suggests the tag was ` +
        `truncated by the scanner: ${JSON.stringify(tag)}`,
    );
  }
});

test('every target="_blank" anchor sets rel to noopener or noreferrer', () => {
  for (const { path, tag } of anchors) {
    if (stringAttribute(tag, 'target') !== '_blank') continue;
    const rel = stringAttribute(tag, 'rel');
    assert.ok(
      rel !== null,
      `${path}: <a target="_blank"> has no literal rel attribute; the opened ` +
        'page keeps a window.opener handle back to this site',
    );
    const tokens = rel.split(/\s+/);
    assert.ok(
      tokens.includes('noopener') || tokens.includes('noreferrer'),
      `${path}: <a target="_blank" rel="${rel}"> must include noopener or ` +
        'noreferrer to sever window.opener',
    );
  }
});

test('every <img> declares an alt attribute', () => {
  for (const { path, tag } of images) {
    assert.ok(
      hasAttribute(tag, 'alt'),
      `${path}: <img> has no alt attribute; screen readers fall back to ` +
        'announcing the file name. Use alt="" for decorative images.',
    );
  }
});

test('no literal href or src in src/ uses plain http', () => {
  for (const { path, text } of sources) {
    for (const [, attribute] of text.matchAll(
      /\s(href|src)\s*=\s*"(http:\/\/[^"]*)"/g,
    )) {
      assert.fail(
        `${path}: ${attribute} is a plain-http reference and is blocked as ` +
          'mixed content on an https site',
      );
    }
  }
});
