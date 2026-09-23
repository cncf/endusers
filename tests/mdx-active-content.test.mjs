import assert from 'node:assert/strict';
import test from 'node:test';
import { findActiveContent } from '../scripts/lib/mdx-active-content.mjs';

const reasons = (markdown) => findActiveContent(markdown).map((f) => f.reason);

test('accepts prose, inert inline tags and the importer-generated preamble', () => {
  const body = [
    "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';",
    '',
    '# Platform',
    '',
    'Runs on Kubernetes<br />and uses <strong>etcd</strong>.',
    '',
    '<CNCFProjectCard name="Kubernetes" href="https://www.cncf.io/projects/kubernetes/" />',
    '',
    '![Diagram](/img/architectures/acme/diagram.svg)',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), []);
});

test('flags script elements, event handlers and script-capable URLs', () => {
  assert.deepEqual(reasons('<script>alert(1)</script>'), [
    'disallowed element <script>',
  ]);
  assert.deepEqual(reasons('<iframe src="https://evil.test"></iframe>'), [
    'disallowed element <iframe>',
  ]);
  assert.deepEqual(reasons('<img src=x onerror=alert(1)>'), [
    'disallowed element <img>',
    'event handler attribute',
  ]);
  assert.deepEqual(reasons('[click](javascript:alert(1))'), [
    'script-capable URL scheme',
  ]);
  assert.deepEqual(reasons('[click](data:text/html;base64,PHN2Zz4=)'), [
    'script-capable URL scheme',
  ]);
});

test('flags ESM statements other than the generated CNCFProjectCard import', () => {
  assert.deepEqual(reasons("import evil from 'https://evil.test/x.js';"), [
    'unexpected ESM statement',
  ]);
  assert.deepEqual(reasons('export const x = 1;'), [
    'unexpected ESM statement',
  ]);
});

test('ignores fenced code blocks and inline code spans, which MDX does not evaluate', () => {
  const body = [
    '# T',
    '',
    '```html',
    '<script>alert(1)</script>',
    '```',
    '',
    'Use `<iframe>` sparingly.',
  ].join('\n');
  assert.deepEqual(findActiveContent(body), []);
});

test('reports the line number of each finding and deduplicates per line and reason', () => {
  const body = ['# T', '', '<script>alert(1)</script>'].join('\n');
  assert.deepEqual(findActiveContent(body), [
    {
      line: 3,
      reason: 'disallowed element <script>',
      snippet: '<script>alert(1)</script>',
    },
  ]);
});

test('tolerates empty and nullish input', () => {
  assert.deepEqual(findActiveContent(''), []);
  assert.deepEqual(findActiveContent(undefined), []);
});
