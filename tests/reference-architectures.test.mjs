// Render contract for src/components/ReferenceArchitectures/index.js.
//
// The component is the whole of /docs/architectures (mounted from
// docs/architectures/index.md), yet no test loaded it — it did not appear in
// the `node --test --experimental-test-coverage` report at all.
//
// scripts/validate-architectures.mjs guards the shape of the catalog JSON;
// nothing guarded what the page does with it. The provenance line's
// target/rel pairing, the logo-versus-initials arm of a card, the industries
// fallback, the four-project cap and the empty-state escape hatch could all
// regress silently. These assertions cover the rendered output.
//
// `<ArchitectureFilters />` is asserted only through the props it is handed:
// the toolbar's own internals belong to tests/architecture-filters.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const ReferenceArchitectures = (
  await importSource('src/components/ReferenceArchitectures/index.js')
).default;
const catalog = (await importSource('data/architectures/catalog.json')).default;
const metrics = (await importSource('data/metrics.json')).default;

// React routes useState/useMemo through a per-render "dispatcher" slot.
// Swapping that slot lets a plain Node test render a stateful component with
// no renderer and no DOM; the slot is restored as soon as the render returns,
// so it never leaks into another test in this process. Same approach as
// tests/case-studies.test.mjs.
const Internals =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

/**
 * Renders a component that uses only useState and useMemo, re-rendering
 * synchronously whenever a state setter is called.
 *
 * @param {Function} Component component under test
 * @returns {{ tree: any }} live view of the most recent element tree
 */
function render(Component) {
  const states = [];
  const memos = [];
  const view = { tree: null };

  function run() {
    let stateSlot = 0;
    let memoSlot = 0;
    const previousDispatcher = Internals.H;
    Internals.H = {
      useState(initial) {
        const slot = stateSlot++;
        if (slot === states.length) {
          states.push(typeof initial === 'function' ? initial() : initial);
        }
        const setState = (next) => {
          const value = typeof next === 'function' ? next(states[slot]) : next;
          if (Object.is(value, states[slot])) return;
          states[slot] = value;
          run();
        };
        return [states[slot], setState];
      },
      useMemo(create, deps) {
        const slot = memoSlot++;
        const previous = memos[slot];
        if (previous && sameDeps(previous.deps, deps)) return previous.value;
        const value = create();
        memos[slot] = { deps, value };
        return value;
      },
    };
    try {
      view.tree = Component();
    } finally {
      Internals.H = previousDispatcher;
    }
  }

  run();
  return view;
}

/**
 * Nested components are yielded by the walker without being descended into.
 * Invoking one renders its subtree, which is how the card and the provenance
 * line — neither of which is exported — are reached.
 *
 * @param {any} tree root element
 * @param {string} name function name of the component to invoke
 * @returns {any} the element tree that component returns
 */
function renderNested(tree, name) {
  const element = [...walkElements(tree)].find(
    (node) => typeof node.type === 'function' && node.type.name === name,
  );
  assert.ok(element, `expected the component to render a <${name} />`);
  return element.type(element.props);
}

/** The component function of the first nested `<name />` in the tree. */
function nestedComponent(tree, name) {
  const element = [...walkElements(tree)].find(
    (node) => typeof node.type === 'function' && node.type.name === name,
  );
  assert.ok(element, `expected the component to render a <${name} />`);
  return element.type;
}

/** The props handed to the `<ArchitectureFilters />` toolbar. */
function toolbarProps(tree) {
  const element = [...walkElements(tree)].find(
    (node) =>
      typeof node.type === 'function' &&
      (node.type.name === 'ArchitectureFilters' ||
        typeof node.props?.onClear === 'function'),
  );
  assert.ok(element, 'expected the component to render the filter toolbar');
  return element.props;
}

const source = metrics?.sources?.architectures;

test('the catalog is a labelled landmark region', () => {
  const { tree } = render(ReferenceArchitectures);
  assert.equal(tree.type, 'section');
  assert.equal(tree.props['aria-label'], 'Reference architecture catalog');
});

test('the meta line counts every catalog entry', () => {
  const { tree } = render(ReferenceArchitectures);
  const meta = findAllByType(tree, 'p')[0];
  assert.equal(
    textOf(meta),
    `${catalog.length} real-world architecture reports from CNCF end users.`,
  );
});

test('one card is rendered per catalog entry, linking to its detail page', () => {
  const { tree } = render(ReferenceArchitectures);
  const cards = [...walkElements(tree)].filter(
    (node) =>
      typeof node.type === 'function' && node.type.name === 'ArchitectureCard',
  );
  assert.equal(cards.length, catalog.length);
  // The card's root is a `<Link>`, which maps `to` onto the anchor's href.
  assert.deepEqual(
    cards.map((card) => card.type(card.props).props.to),
    catalog.map((architecture) => `/architectures/${architecture.id}`),
  );
  const [first] = cards;
  const link = first.type(first.props);
  assert.equal(
    findByType(link.type(link.props), 'a').props.href,
    `/architectures/${catalog[0].id}`,
  );
});

test('the toolbar is told how many results of how many total are shown', () => {
  const { tree } = render(ReferenceArchitectures);
  const props = toolbarProps(tree);
  assert.equal(props.totalCount, catalog.length);
  assert.equal(
    props.resultCount,
    catalog.length,
    'an unfiltered catalog shows every entry',
  );
  assert.equal(props.activeCount, 0);
  assert.deepEqual(
    props.options.organizations,
    [...new Set(catalog.map((a) => a.organization))].sort(),
  );
});

test('a query that matches nothing swaps the grid for the empty state', () => {
  const view = render(ReferenceArchitectures);
  toolbarProps(view.tree).setQuery('no architecture is named this');

  assert.equal(
    findAllByType(view.tree, 'h2').length,
    0,
    'no organization headings survive an empty result set',
  );
  assert.equal(textOf(findByType(view.tree, 'h3')), 'No architectures match');
  assert.equal(toolbarProps(view.tree).resultCount, 0);
  assert.equal(
    toolbarProps(view.tree).totalCount,
    catalog.length,
    'the total is the catalog size, not the filtered size',
  );
});

test('the empty state clear button restores the full grid', () => {
  const view = render(ReferenceArchitectures);
  toolbarProps(view.tree).setQuery('no architecture is named this');

  const button = findByType(view.tree, 'button');
  assert.equal(textOf(button), 'Clear filters');
  assert.equal(button.props.type, 'button');
  button.props.onClick();

  assert.equal(
    findAllByType(view.tree, 'h3').length,
    0,
    'the empty state is gone once the filters are cleared',
  );
  assert.equal(toolbarProps(view.tree).resultCount, catalog.length);
});

test('the sync status cites the mirrored revision and its commit', (t) => {
  if (!source?.revision) {
    t.skip('data/metrics.json records no architecture source revision');
    return;
  }
  const { tree } = render(ReferenceArchitectures);
  const status = renderNested(tree, 'SyncStatus');
  const links = findAllByType(status, 'a');

  assert.equal(links.length, 2);
  assert.equal(links[0].props.href, source.repository);
  assert.equal(textOf(links[0]), 'cncf/architecture');
  assert.equal(
    links[1].props.href,
    `${source.repository}/commit/${source.revision}`,
  );
  assert.equal(
    textOf(links[1]),
    source.revision.slice(0, 7),
    'the commit link shows the abbreviated revision',
  );
  assert.equal(findByType(links[1], 'code') !== undefined, true);
});

test('every outbound sync-status link pairs target=_blank with rel=noreferrer', (t) => {
  if (!source?.revision) {
    t.skip('data/metrics.json records no architecture source revision');
    return;
  }
  const { tree } = render(ReferenceArchitectures);
  const links = findAllByType(renderNested(tree, 'SyncStatus'), 'a');
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.equal(link.props.target, '_blank');
    assert.equal(
      link.props.rel,
      'noreferrer',
      `${link.props.href} opens a new tab without rel="noreferrer"`,
    );
  }
});

test('the sync status renders the generation date in UTC', (t) => {
  if (!source?.revision || !metrics.generatedAt) {
    t.skip('data/metrics.json records no generation timestamp');
    return;
  }
  const { tree } = render(ReferenceArchitectures);
  const expected = new Date(metrics.generatedAt).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.match(textOf(renderNested(tree, 'SyncStatus')), /^Last synced from /);
  assert.ok(
    textOf(renderNested(tree, 'SyncStatus')).endsWith(` on ${expected}.`),
    'the provenance line ends with the UTC-formatted sync date',
  );
});

test('a card shows the logo asset when one is mirrored', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'Acme Corp',
      title: 'A title',
      summary: 'A summary',
      industries: ['Software'],
      projects: ['Kubernetes'],
      assets: ['/img/architectures/acme/diagram.png', '/img/acme/logo.svg'],
    },
  });

  const image = findByType(card, 'img');
  assert.equal(image.props.src, '/img/acme/logo.svg');
  assert.equal(
    image.props.alt,
    '',
    'the logo is decorative: the organization name is already in the heading',
  );
  assert.equal(
    findAllByType(card, 'span').some((s) => textOf(s) === 'AC'),
    false,
    'the initials fallback is not rendered alongside a logo',
  );
});

test('a wordmark asset is accepted as the logo, case-insensitively', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'Acme Corp',
      title: 'A title',
      summary: 'A summary',
      industries: [],
      projects: [],
      assets: ['/img/acme/Wordmark.svg'],
    },
  });
  assert.equal(findByType(card, 'img').props.src, '/img/acme/Wordmark.svg');
});

test('a card with no logo asset falls back to two-letter initials', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'acme telecom holdings',
      title: 'A title',
      summary: 'A summary',
      industries: ['Telecom'],
      projects: [],
      assets: ['/img/architectures/acme/diagram.png'],
    },
  });

  assert.equal(findByType(card, 'img'), undefined);
  assert.equal(
    textOf(findByType(card, 'div')),
    'AT',
    'initials take the first letter of at most the first two words, uppercased',
  );
});

test('a card with no assets array at all still renders initials', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'Acme',
      title: 'A title',
      summary: 'A summary',
      industries: [],
      projects: [],
    },
  });
  assert.equal(findByType(card, 'img'), undefined);
  assert.equal(textOf(findByType(card, 'div')), 'A');
});

test('the card eyebrow joins industries and falls back when there are none', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const base = {
    id: 'acme',
    organization: 'Acme',
    title: 'A title',
    summary: 'A summary',
    projects: [],
    assets: [],
  };

  const joined = ArchitectureCard({
    architecture: { ...base, industries: ['Software', 'Telecom'] },
  });
  assert.equal(textOf(findAllByType(joined, 'p')[0]), 'Software · Telecom');

  const fallback = ArchitectureCard({
    architecture: { ...base, industries: [] },
  });
  assert.equal(
    textOf(findAllByType(fallback, 'p')[0]),
    'Reference architecture',
  );
});

test('a card tags at most four projects', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const projects = ['a', 'b', 'c', 'd', 'e', 'f'];
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'Acme',
      title: 'A title',
      summary: 'A summary',
      industries: ['Software'],
      projects,
      assets: [],
    },
  });

  const tags = findAllByType(card, 'span').filter((span) =>
    projects.includes(textOf(span)),
  );
  assert.deepEqual(
    tags.map(textOf),
    ['a', 'b', 'c', 'd'],
    'only the first four projects are tagged',
  );
});

test('a card renders the organization, title, summary and call to action', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'Acme',
      title: 'Scaling Acme',
      summary: 'How Acme scaled.',
      industries: ['Software'],
      projects: ['Kubernetes'],
      assets: [],
    },
  });

  assert.equal(textOf(findByType(card, 'h2')), 'Acme');
  const paragraphs = findAllByType(card, 'p').map(textOf);
  assert.deepEqual(paragraphs, [
    'Software',
    'Scaling Acme',
    'How Acme scaled.',
  ]);
  assert.ok(
    findAllByType(card, 'span').some(
      (span) => textOf(span) === 'View architecture →',
    ),
    'the card ends with its call to action',
  );
});

test('the logo wrapper is hidden from assistive technology', () => {
  const { tree } = render(ReferenceArchitectures);
  const ArchitectureCard = nestedComponent(tree, 'ArchitectureCard');
  const card = ArchitectureCard({
    architecture: {
      id: 'acme',
      organization: 'Acme',
      title: 'A title',
      summary: 'A summary',
      industries: [],
      projects: [],
      assets: [],
    },
  });
  assert.equal(findByType(card, 'div').props['aria-hidden'], 'true');
});
