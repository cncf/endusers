// src/components/ProjectsBorn/index.js renders the full section embedded by
// docs/community/index.md and docs/practitioners/index.md.
//
// tests/footer.test.mjs checks that the footer does not render ProjectsBorn;
// these assertions cover what the component renders.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const { default: ProjectsBorn } = await importSource(
  'src/components/ProjectsBorn/index.js',
);

// The component imports the corpus through the `@site` alias at module scope,
// so the test has to assert against the same checked-in file rather than an
// injected fixture.
const projects = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../data/projects-born.json', import.meta.url)),
    'utf8',
  ),
);

const DEFAULT_TITLE = 'Projects born at end-user organizations';

function anchorsOf(tree) {
  return findAllByType(tree, 'a').filter((node) => node.props?.href);
}

function projectAnchors(tree) {
  const urls = new Set(projects.map((project) => project.url));
  return anchorsOf(tree).filter((node) => urls.has(node.props.href));
}

test('the full form renders one anchor per project in corpus order', () => {
  const anchors = projectAnchors(ProjectsBorn({}));
  assert.equal(anchors.length, projects.length);
  assert.deepEqual(
    anchors.map((node) => node.props.href),
    projects.map((project) => project.url),
  );
});

test('every project tile is keyed, so React can reorder the list', () => {
  for (const anchor of projectAnchors(ProjectsBorn({}))) {
    assert.ok(anchor.key, 'expected a stable key on each project tile');
  }
});

test('each project contributes its name and origin to the rendered text', () => {
  const text = textOf(ProjectsBorn({}));
  for (const project of projects) {
    assert.match(text, new RegExp(escape(project.name)));
    assert.match(text, new RegExp(`Born at ${escape(project.origin)}`));
  }
});

test('the full form carries the kicker, default title, intro and TAB footer note', () => {
  const text = textOf(ProjectsBorn({}));
  assert.match(text, /Production becomes open source/);
  assert.match(text, new RegExp(escape(DEFAULT_TITLE)));
  assert.match(text, /Some of the most widely adopted CNCF projects/);
  assert.match(text, /Talk to the End User TAB/);
});

test('the full form prints every project description', () => {
  const text = textOf(ProjectsBorn({}));
  for (const project of projects) {
    assert.match(text, new RegExp(escape(project.description)));
  }
});

test('the section labels its heading with the stable id', () => {
  const sectionId = headingIdOf(ProjectsBorn({}));
  assert.equal(sectionId, 'projects-born-title-section');
});

test('the section points aria-labelledby at a heading that exists in its own tree', () => {
  const tree = ProjectsBorn({});
  assert.equal(tree.type, 'section');
  const labelledBy = tree.props['aria-labelledby'];
  assert.ok(labelledBy, 'expected the section to be labelled');
  const heading = findByType(tree, 'h2');
  assert.ok(heading, 'expected an h2 inside the section');
  assert.equal(heading.props.id, labelledBy);
});

test('the title and intro props override the defaults', () => {
  // docs/practitioners/index.md renders the section with its own copy.
  const tree = ProjectsBorn({
    title: 'Built in production, donated to CNCF',
    intro: 'A practitioner-facing framing of the same corpus.',
  });
  const text = textOf(tree);
  assert.match(text, /Built in production, donated to CNCF/);
  assert.match(text, /A practitioner-facing framing of the same corpus\./);
  assert.doesNotMatch(text, new RegExp(escape(DEFAULT_TITLE)));
});

test('the decorative arrow is hidden from assistive technology', () => {
  const arrows = [...walkElements(ProjectsBorn({}))].filter(
    (node) => textOf(node) === '↗',
  );
  assert.equal(arrows.length, projects.length);
  for (const arrow of arrows) {
    assert.equal(arrow.props['aria-hidden'], 'true');
  }
});

test('no project tile opens a new tab without noreferrer', () => {
  for (const anchor of anchorsOf(ProjectsBorn({}))) {
    if (anchor.props.target === '_blank') {
      assert.match(anchor.props.rel ?? '', /\bnoreferrer\b/);
    }
  }
});

function headingIdOf(tree) {
  return findByType(tree, 'h2')?.props?.id;
}

function escape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
