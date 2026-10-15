import assert from 'node:assert/strict';
import test from 'node:test';

import { firstParagraph } from '../scripts/lib/architecture-content.mjs';

// firstParagraph() is reached only through scripts/import-architecture-issue.mjs,
// so without these pins every assertion about it would be an assertion about a
// whole importer run: the lines execute, but nothing states what they return.

test('firstParagraph skips headings, images, lists and markup', () => {
  assert.equal(
    firstParagraph('# Heading\n\n![img](x.png)\n\nReal text *here*.'),
    'Real text here.',
  );
});

test('firstParagraph returns the empty string when nothing qualifies', () => {
  // The `?? ''` matters to the caller: the catalog summary is a string field,
  // and a page that is nothing but a heading must still produce one.
  assert.equal(firstParagraph('# only heading'), '');
  assert.equal(firstParagraph(''), '');
});

test('firstParagraph caps the summary at 240 characters', () => {
  const long = `${'x'.repeat(300)}`;
  assert.equal(firstParagraph(long).length, 240);
});
