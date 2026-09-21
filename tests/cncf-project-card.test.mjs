// CNCFProjectCard renders every project tile on the reference-architecture and
// project pages. Its output is entirely prop-driven — the logo/initial
// fallback, the optional "since"/"version" metadata row and the optional
// description are three independent conditional branches — and none of it had
// any unit coverage, so a regression in the fallback path or in the
// `target="_blank"`/`rel="noreferrer"` pairing would ship unnoticed.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
} from './tools/react-element-tree.mjs';

const { default: CNCFProjectCard } = await importSource(
  'src/components/CNCFProjectCard/index.js',
);

const BASE_PROPS = {
  name: 'Kubernetes',
  href: 'https://www.cncf.io/projects/kubernetes/',
};

function render(overrides = {}) {
  return CNCFProjectCard({ ...BASE_PROPS, ...overrides });
}

test('the card is a single anchor pointing at the project href', () => {
  const tree = render();
  assert.equal(tree.type, 'a');
  assert.equal(tree.props.href, 'https://www.cncf.io/projects/kubernetes/');
  assert.equal(findAllByType(tree, 'a').length, 1);
});

test('an externally opened card cannot reach back through window.opener', () => {
  const { props } = render();
  assert.equal(props.target, '_blank');
  assert.match(props.rel, /\bnoreferrer\b/);
});

test('the project name is rendered as text', () => {
  assert.match(textOf(render()), /Kubernetes/);
});

test('a logo is rendered as a decorative image at its base URL', () => {
  const tree = render({ logo: 'img/projects/kubernetes.svg' });
  const img = findByType(tree, 'img');
  assert.ok(img, 'expected an <img> for the supplied logo');
  assert.equal(img.props.src, '/img/projects/kubernetes.svg');
  assert.equal(
    img.props.alt,
    '',
    'the adjacent name already carries the text, so the logo must be marked decorative',
  );
});

test('an absolute logo URL is left untouched', () => {
  const tree = render({ logo: 'https://cdn.example/k8s.svg' });
  assert.equal(
    findByType(tree, 'img').props.src,
    'https://cdn.example/k8s.svg',
  );
});

test('a missing logo falls back to the first letter of the name', () => {
  const tree = render({ name: 'Prometheus' });
  assert.equal(
    findByType(tree, 'img'),
    undefined,
    'no <img> should be emitted when no logo is supplied',
  );
  assert.match(textOf(tree), /^P/);
});

test('an empty logo string falls back rather than requesting an empty src', () => {
  const tree = render({ logo: '' });
  assert.equal(findByType(tree, 'img'), undefined);
});

test('the metadata row is omitted when neither since nor version is given', () => {
  const text = textOf(render());
  assert.doesNotMatch(text, /Since/);
});

test('since alone renders the metadata row without a version', () => {
  const text = textOf(render({ since: '2016' }));
  assert.match(text, /Since 2016/);
});

test('version alone renders the metadata row without a since date', () => {
  const text = textOf(render({ version: 'v1.31' }));
  assert.match(text, /v1\.31/);
  assert.doesNotMatch(text, /Since/);
});

test('since and version both render when supplied together', () => {
  const text = textOf(render({ since: '2016', version: 'v1.31' }));
  assert.match(text, /Since 2016/);
  assert.match(text, /v1\.31/);
});

test('a description renders in its own paragraph, and is omitted otherwise', () => {
  const described = render({ description: 'Container orchestration.' });
  const paragraph = findByType(described, 'p');
  assert.ok(paragraph, 'expected a <p> for the description');
  assert.equal(textOf(paragraph), 'Container orchestration.');

  assert.equal(
    findByType(render(), 'p'),
    undefined,
    'no empty paragraph should be emitted without a description',
  );
});

test('the decorative arrow is hidden from assistive technology', () => {
  const arrows = [...findAllByType(render(), 'span')].filter((span) =>
    textOf(span).includes('↗'),
  );
  assert.ok(arrows.length > 0, 'expected the ↗ affordance');
  for (const arrow of arrows) {
    if (textOf(arrow) === '↗')
      assert.equal(arrow.props['aria-hidden'], 'true');
  }
});
