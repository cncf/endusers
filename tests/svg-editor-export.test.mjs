import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEditorExport } from '../scripts/lib/svg-editor-export.mjs';
import { findActiveContent } from '../scripts/lib/svg-active-content.mjs';

const ILLUSTRATOR_EXPORT = [
  '<?xml version="1.0" encoding="utf-16"?>',
  '<!-- Generator: Adobe Illustrator 19.2.1 -->',
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [',
  '\t<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">',
  "\t<!ENTITY ns_ai 'http://ns.adobe.com/AdobeIllustrator/10.0/'>",
  ']>',
  '<svg version="1.1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="http://www.w3.org/2000/svg">',
  '<switch><g i:extraneous="self"><rect width="1" height="1"/></g></switch>',
  '<i:pgf id="adobe_illustrator_pgf">&amp;x</i:pgf>',
  '</svg>',
].join('\n');

test('expands Illustrator namespace entities, drops the DOCTYPE and relabels the encoding', () => {
  const normalized = normalizeEditorExport(ILLUSTRATOR_EXPORT);

  assert.match(normalized, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.doesNotMatch(normalized, /<!DOCTYPE|<!ENTITY|&ns_extend;|&ns_ai;/);
  assert.match(
    normalized,
    /xmlns:x="http:\/\/ns\.adobe\.com\/Extensibility\/1\.0\/" xmlns:i="http:\/\/ns\.adobe\.com\/AdobeIllustrator\/10\.0\/"/,
  );
  assert.match(
    normalized,
    /<!-- Generator: Adobe Illustrator 19\.2\.1 -->\n\n<svg/,
  );
  assert.ok(
    normalized.includes('&amp;x'),
    'built-in references are left for the parser',
  );
  assert.deepEqual(findActiveContent(normalized), []);
});

test('an undeclared reference is left in place for the gate to reject', () => {
  const source =
    '<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg" a="&e;" b="&f;"/>';
  const normalized = normalizeEditorExport(source);
  assert.match(normalized, /a="x" b="&f;"/);
  assert.ok(findActiveContent(normalized).length > 0);
});

test('tolerates the whitespace and identifier variants editors emit', () => {
  const spaced = [
    '\n  <?xml version="1.0"   encoding = "UTF-16" ?>',
    '<!DOCTYPE  svg   SYSTEM   "svg11.dtd"  [',
    '  <!ENTITY   ns_ai   "http://ns.adobe.com/AdobeIllustrator/10.0/"  >',
    ']  \n>',
    '<svg xmlns:i="&ns_ai;" xmlns="http://www.w3.org/2000/svg"/>',
  ].join('\n');
  const normalized = normalizeEditorExport(spaced);
  assert.ok(
    normalized.startsWith('\n  <?xml version="1.0"   encoding = "utf-8" ?>'),
  );
  assert.doesNotMatch(normalized, /<!DOCTYPE|&ns_ai;/);
  assert.match(
    normalized,
    /xmlns:i="http:\/\/ns\.adobe\.com\/AdobeIllustrator\/10\.0\/"/,
  );

  const publicId = `<!DOCTYPE svg  PUBLIC  "-//W3C//DTD SVG 1.1//EN"  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg" a="&e;"/>`;
  assert.equal(
    normalizeEditorExport(publicId),
    '<svg xmlns="http://www.w3.org/2000/svg" a="x"/>',
  );
});

test('a document without a DOCTYPE subset only has its encoding relabelled', () => {
  const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  assert.equal(normalizeEditorExport(plain), plain);

  const declared = `<?xml version='1.0' encoding='ISO-8859-1' standalone='yes'?>\n${plain}`;
  assert.equal(
    normalizeEditorExport(declared),
    `<?xml version='1.0' encoding="utf-8" standalone='yes'?>\n${plain}`,
  );

  const noSubset = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${plain}`;
  assert.equal(normalizeEditorExport(noSubset), noSubset);

  const empty = `<!DOCTYPE svg [ ]>\n${plain}`;
  assert.equal(normalizeEditorExport(empty), empty);
});

test('an encoding label is only touched at the top of the document', () => {
  const late =
    '<svg xmlns="http://www.w3.org/2000/svg"><desc><?xml encoding="utf-16"?></desc></svg>';
  assert.equal(normalizeEditorExport(late), late);
});

const EXPAND = (subset) =>
  `<!DOCTYPE svg [${subset}]><svg xmlns="http://www.w3.org/2000/svg" a="&e;"/>`;

for (const [reason, subset] of [
  ['a value carrying markup', '<!ENTITY e "<script>alert(1)</script>">'],
  ['a value with a nested reference', '<!ENTITY e "&f;"><!ENTITY f "x">'],
  ['a value with a quote', '<!ENTITY e "a\'b">'],
  ['a value with a space', '<!ENTITY e "javascript:alert 1">'],
  ['an external entity', '<!ENTITY e SYSTEM "http://evil.test/x">'],
  ['a parameter entity', '<!ENTITY % e "x">'],
  ['a lower-case keyword', '<!entity e "x">'],
  ['an element declaration', '<!ENTITY e "x"><!ELEMENT svg ANY>'],
  ['a comment', '<!ENTITY e "x"><!-- note -->'],
  ['a bracket inside a value', '<!ENTITY e "a]b">'],
]) {
  test(`leaves a subset with ${reason} untouched for the gate`, () => {
    const source = EXPAND(subset);
    assert.equal(normalizeEditorExport(source), source);
    assert.ok(findActiveContent(source).length > 0);
  });
}

test('a second DOCTYPE or a stray declaration disables expansion', () => {
  const twice = `<!DOCTYPE svg [<!ENTITY e "x">]><!DOCTYPE svg [<!ENTITY f "y">]><svg xmlns="http://www.w3.org/2000/svg" a="&e;"/>`;
  assert.equal(normalizeEditorExport(twice), twice);

  const stray = `<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg" a="&e;"><!ENTITY f "y"></svg>`;
  assert.equal(normalizeEditorExport(stray), stray);

  const earlier = `<!DOCTYPE other [<!ENTITY f "y">]><!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg" a="&e;"/>`;
  assert.equal(normalizeEditorExport(earlier), earlier);
});

test('an expanded payload is visible to the gate instead of hidden behind the reference', () => {
  const source =
    '<!DOCTYPE svg [<!ENTITY js "javascript:top.name=1">]><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&js;"><rect/></a></svg>';
  const normalized = normalizeEditorExport(source);
  assert.match(normalized, /xlink:href="javascript:top.name=1"/);
  assert.doesNotMatch(normalized, /<!DOCTYPE/);
  assert.ok(
    findActiveContent(normalized).some((finding) =>
      /javascript/i.test(finding),
    ),
    'the gate now sees the scheme the entity hid',
  );
});
