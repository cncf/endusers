// The prolog walk in svg-active-content.mjs must finish on a truncated file.
//
// `startsWithDoctype()` exists because `sax` swallows a DOCTYPE whose internal
// subset never closes and parses what follows as markup, so parseXml() re-reads
// the prolog itself to raise "Unterminated DOCTYPE". Its own comment explains
// why it is a linear walk rather than a pattern: nested lazy repetition over
// `<?...?>` and `<!--...-->` backtracks exponentially on adversarial input.
//
// Swapping a catastrophic regex for a loop moves the hazard rather than
// removing it. `index` advances by `source.indexOf(closer, index + 2) +
// closer.length`, and `indexOf` returns -1 for a prolog node that is never
// closed -- so without the `end === -1` guard, `index` rewinds to
// `closer.length - 1` and the walk revisits the same unterminated `<?` for
// ever. A single leading space or newline is enough to put it there: the
// whitespace skip at the top of the loop carries `index` straight back to the
// `<?`, and the walk never terminates.
//
// That is not a hypothetical shape. Every validator in this repository calls
// these entry points on SVG files it did not write, and a file truncated in
// transit mid-declaration -- `\n<?xml version="1.0"` and nothing more -- is the
// ordinary way a prolog node ends up unclosed. A scanner that hangs on it fails
// open by never answering at all, which is the one failure mode the module is
// written to avoid.
//
// The guard is load-bearing and no other test pins it: deleting the `return`,
// or flipping the sentinel it compares against, leaves every other assertion in
// the suite passing. These tests fail by not finishing, so each one is given a
// deadline of its own rather than relying on the runner's.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findActiveContent,
  findRemoteReferences,
  hasDoctype,
  stripDoctype,
} from '../scripts/lib/svg-active-content.mjs';

// Well under `node --test`'s own timeout, and far above the microseconds the
// linear walk needs, so a failure here means non-termination and not a slow
// machine.
const DEADLINE_MS = 2000;

const withinDeadline = (label, run) => {
  const started = process.hrtime.bigint();
  const value = run();
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(
    elapsed < DEADLINE_MS,
    `${label} took ${elapsed.toFixed(1)}ms, over the ${DEADLINE_MS}ms deadline`,
  );
  return value;
};

// Each one puts an unterminated prolog node after leading whitespace, which is
// the arrangement that sends the rewound index back to the same node.
const TRUNCATED = {
  'a newline then a truncated XML declaration': '\n<?xml version="1.0"',
  'a space then an unnamed processing instruction': ' <?x',
  'several spaces then a truncated declaration': '   <?xml version="1.0" enc',
  'a tab then a truncated processing instruction': '\t<?xml-stylesheet href=',
  'a BOM, whitespace and a truncated declaration': '\uFEFF <?xml version="1.0"',
  'a closed node, whitespace, then a truncated one': '<?a b?> <?xml version=',
  'whitespace then an unterminated comment': ' <!-- a comment that never ends',
  'a closed comment then a truncated declaration': '<!-- c -->\n<?xml version=',
};

for (const [shape, source] of Object.entries(TRUNCATED)) {
  test(`hasDoctype answers for ${shape}`, () => {
    assert.equal(
      withinDeadline('hasDoctype', () => hasDoctype(source)),
      false,
    );
  });

  test(`stripDoctype answers for ${shape}`, () => {
    // Nothing is well-formed here, so the source comes back untouched; the
    // point of the assertion is that it comes back at all.
    assert.equal(
      withinDeadline('stripDoctype', () => stripDoctype(source)),
      source,
    );
  });

  test(`findActiveContent answers for ${shape}`, () => {
    const findings = withinDeadline('findActiveContent', () =>
      findActiveContent(source),
    );
    assert.ok(
      findings.some((finding) => finding.includes('is not well-formed XML')),
      `expected a well-formedness finding, got ${JSON.stringify(findings)}`,
    );
  });

  test(`findRemoteReferences answers for ${shape}`, () => {
    const findings = withinDeadline('findRemoteReferences', () =>
      findRemoteReferences(source),
    );
    assert.ok(
      findings.some((finding) => finding.includes('is not well-formed XML')),
      `expected a well-formedness finding, got ${JSON.stringify(findings)}`,
    );
  });
}

// The guard must not cost the walk its real job: it still has to step over
// closed prolog nodes and see what is behind them.
test('a DOCTYPE behind closed prolog nodes is still reached', () => {
  const source =
    '<?xml version="1.0"?>\n<!-- a note -->\n<!DOCTYPE svg>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  assert.equal(
    withinDeadline('hasDoctype', () => hasDoctype(source)),
    true,
  );
});

test('a prolog with no DOCTYPE behind it raises no DOCTYPE finding', () => {
  const source =
    '<?xml version="1.0"?>\n<!-- a note -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const findings = withinDeadline('findActiveContent', () =>
    findActiveContent(source),
  );
  assert.deepEqual(findings, []);
  assert.equal(hasDoctype(source), false);
});
