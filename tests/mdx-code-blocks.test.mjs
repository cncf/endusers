import assert from 'node:assert/strict';
import test from 'node:test';
import { isUnwrappedCodeBlock } from '../scripts/lib/mdx-code-blocks.mjs';

// The whole document is a block Docusaurus unwraps, so any node whose
// position is missing or partial must still answer false: slicing with an
// undefined offset would hand the entire source to unwrapMdxCodeBlocks() and
// report a block the node does not stand for.
const SOURCE = '```mdx-code-block\n<b>x</b>\n```';

test('reports false for a node without a usable source range', () => {
  for (const node of [
    {},
    { position: {} },
    { position: { start: {} } },
    { position: { start: { offset: 0 } } },
    { position: { end: { offset: SOURCE.length } } },
    { position: { start: {}, end: { offset: SOURCE.length } } },
  ]) {
    assert.equal(
      isUnwrappedCodeBlock(SOURCE, node),
      false,
      JSON.stringify(node),
    );
  }
});

test('reports true for a node spanning the whole unwrapped block', () => {
  const node = {
    position: { start: { offset: 0 }, end: { offset: SOURCE.length } },
  };
  assert.equal(isUnwrappedCodeBlock(SOURCE, node), true);
});
