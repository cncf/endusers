/**
 * Mirror-time normalization for SVGs exported by desktop editors.
 *
 * Adobe Illustrator writes its namespace URIs as general entities in an
 * internal DTD subset (`<!ENTITY ns_ai "http://ns.adobe.com/...">` paired with
 * `xmlns:i="&ns_ai;"`), and some exports declare `encoding="utf-16"` over
 * UTF-8 bytes. The active-content gate in `./svg-active-content.mjs` fails
 * closed on both, correctly: it cannot see what a parser would make of an
 * entity it does not expand, and an encoding it did not decode under.
 *
 * This module does the expansion the parser would do, but only for the one
 * shape an editor export has: every declaration in the subset is an internal
 * general entity whose replacement text is a bare URI-like token with no
 * markup, no nested reference and no quote. Under that grammar expansion is a
 * single textual substitution, so the result is exactly the document a
 * browser parses, and the gate then scans it in full. Any other subset
 * (external entities, parameter entities, nested references, markup in a
 * value, anything this grammar does not recognize) is left untouched for the
 * gate to reject as it does today.
 */

const ENTITY_NAME = '[A-Za-z_][A-Za-z0-9._-]*';
const ENTITY_VALUE = '[A-Za-z0-9:/._~#?=+-]*';

/** One internal general entity declaration under the editor-export grammar. */
const ENTITY_DECLARATION = new RegExp(
  `<!ENTITY\\s+(${ENTITY_NAME})\\s+(?:"(${ENTITY_VALUE})"|'(${ENTITY_VALUE})')\\s*>`,
  'g',
);

/**
 * A DOCTYPE for `svg` that carries an internal subset. The lazy subset match
 * stops at the first `]`; a `]` inside a declaration therefore leaves the
 * subset failing the grammar below, and the document is returned unchanged.
 */
const DOCTYPE_WITH_SUBSET =
  /<!DOCTYPE\s+svg(?:\s+PUBLIC\s+"[^"]*"\s+"[^"]*"|\s+SYSTEM\s+"[^"]*")?\s*\[([\s\S]*?)\]\s*>/;

/** The `encoding` pseudo-attribute of an XML declaration at the top of a file. */
const DECLARED_ENCODING =
  /^(\s*<\?xml\b[^>]*?\bencoding\s*=\s*)(?:"[^"]*"|'[^']*')/;

/**
 * Parse an internal subset that consists only of editor-export entity
 * declarations, or return null when anything else is in it.
 *
 * @param {string} subset
 * @returns {Map<string, string> | null}
 */
function parseEntitySubset(subset) {
  const entities = new Map();
  const rest = subset.replace(ENTITY_DECLARATION, (_, name, dq, sq) => {
    entities.set(name, dq ?? sq);
    return '';
  });
  if (rest.trim() !== '' || entities.size === 0) return null;
  return entities;
}

/**
 * Expand editor-export entities and drop the DOCTYPE that declared them, and
 * relabel the encoding declaration as UTF-8, which is what the mirror writes.
 *
 * @param {string} source an SVG document decoded as UTF-8
 * @returns {string}
 */
export function normalizeEditorExport(source) {
  let text = String(source).replace(DECLARED_ENCODING, '$1"utf-8"');

  const doctype = DOCTYPE_WITH_SUBSET.exec(text);
  if (!doctype) return text;
  const entities = parseEntitySubset(doctype[1]);
  if (!entities) return text;

  const before = text.slice(0, doctype.index);
  const after = text.slice(doctype.index + doctype[0].length);
  // A second DOCTYPE, or a declaration outside the subset just parsed, is not
  // the editor-export shape; leave the whole document for the gate.
  if (/<!(?:DOCTYPE|ENTITY)\s/i.test(before + after)) return text;

  const reference = new RegExp(`&(${ENTITY_NAME});`, 'g');
  text =
    before +
    after.replace(reference, (match, name) =>
      entities.has(name) ? entities.get(name) : match,
    );
  return text;
}
