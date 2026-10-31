// Contract for src/components/EventsIndex, the component that renders the
// events-catalog plugin's global data on /events (ADR 0012), and for the
// plugin that publishes it. The default export calls only usePluginData,
// stubbed by tests/tools/docusaurus-stubs/useGlobalData.mjs, so it can be
// invoked directly; it hands the plugin's years to the hook-free EventsCatalog,
// which renderElement() expands, and EventRow is hook-free too, so the walker
// expands it inline.

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importSource } from './helpers-jsx.mjs';
import Link from './tools/docusaurus-stubs/Link.mjs';
import { setPluginData } from './tools/docusaurus-stubs/useGlobalData.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  renderElement,
  walkElements,
} from './tools/react-element-tree.mjs';

const { default: EventsIndex, EventsCatalog } = await importSource(
  'src/components/EventsIndex/index.js',
);
const { default: eventsCatalogPlugin, PLUGIN_NAME } =
  await import('../scripts/lib/events-catalog-plugin.mjs');
const { collectEvents, groupByYear } =
  await import('../scripts/lib/events-catalog.mjs');

const siteDir = fileURLToPath(new URL('..', import.meta.url));

const expandAll = { expand: () => true };

function event(overrides) {
  return {
    id: '2026/kubecon-na',
    docId: 'events/2026/kubecon-na',
    route: '/events/2026/kubecon-na',
    year: 2026,
    title: 'KubeCon + CloudNativeCon North America 2026',
    description: 'End user talks in Salt Lake City.',
    start: '2026-11-09',
    end: '2026-11-12',
    location: 'Salt Lake City, Utah',
    url: 'https://example.test/kubecon-na',
    ...overrides,
  };
}

const TWO_YEARS = {
  years: [
    {
      year: 2026,
      events: [
        event(),
        event({
          id: '2026/kubecon-eu',
          route: '/events/2026/kubecon-eu',
          title: 'KubeCon + CloudNativeCon Europe 2026',
          start: '2026-03-23',
          end: '2026-03-26',
          location: 'Amsterdam, Netherlands',
        }),
      ],
    },
    {
      year: 2025,
      events: [
        event({
          id: '2025/kubecon-na',
          route: '/events/2025/kubecon-na',
          year: 2025,
          title: 'KubeCon + CloudNativeCon North America 2025',
          start: '2025-11-10',
          end: '2025-11-13',
          location: 'Atlanta, Georgia',
        }),
      ],
    },
    {
      year: 2024,
      events: [
        event({
          id: '2024/kubecon-na',
          route: '/events/2024/kubecon-na',
          year: 2024,
          start: '2024-11-12',
          end: '2024-11-15',
        }),
      ],
    },
  ],
};

// The tree EventsCatalog returns for the plugin data `data`, via the default
// export, so every assertion below also proves the container passes the
// plugin's years through unchanged.
function render(data) {
  const restore = setPluginData(PLUGIN_NAME, data);
  try {
    const container = EventsIndex();
    assert.equal(container.type, EventsCatalog);
    assert.equal(container.props.years, data.years);
    return renderElement(container);
  } finally {
    restore();
  }
}

function rows(tree) {
  return findAllByType(tree, 'li', expandAll);
}

test('the component reads the events-catalog plugin data by name', () => {
  assert.throws(() => EventsIndex(), /events-catalog/);
});

test('the newest year is the section heading and labels the section', () => {
  const tree = render(TWO_YEARS);
  assert.equal(tree.type, 'section');
  const heading = findByType(tree, 'h2');
  assert.equal(textOf(heading), '2026');
  assert.equal(tree.props['aria-labelledby'], heading.props.id);
});

test('only the newest year is listed, in catalog order, one row per event', () => {
  const tree = render(TWO_YEARS);
  const list = findByType(tree, 'ol');
  assert.ok(list, 'events render as an ordered list');
  const titles = rows(tree).map((row) => textOf(findByType(row, 'h3')));
  assert.deepEqual(titles, [
    'KubeCon + CloudNativeCon North America 2026',
    'KubeCon + CloudNativeCon Europe 2026',
  ]);
});

test('each row links its title to the event page through Link', () => {
  const [first] = rows(render(TWO_YEARS));
  const link = findByType(first, Link);
  assert.equal(link.props.to, '/events/2026/kubecon-na');
  assert.equal(textOf(link), 'KubeCon + CloudNativeCon North America 2026');
});

test('each row carries the date range, location and description', () => {
  const [first] = rows(render(TWO_YEARS));
  const time = findByType(first, 'time');
  assert.equal(time.props.dateTime, '2026-11-09');
  assert.equal(textOf(time), 'November 9–12, 2026');
  const text = textOf(first);
  assert.match(text, /Salt Lake City, Utah/);
  assert.match(text, /End user talks in Salt Lake City\./);
});

test('the calendar block is decorative and shows the start month and day span', () => {
  const [first, second] = rows(render(TWO_YEARS));
  const block = findByType(first, 'div');
  assert.equal(block.props['aria-hidden'], 'true');
  const spans = findAllByType(block, 'span').map(textOf);
  assert.deepEqual(spans, ['Nov', '9–12']);
  assert.deepEqual(
    findAllByType(findByType(second, 'div'), 'span').map(textOf),
    ['Mar', '23–26'],
  );
});

test('a single-day or month-spanning event shows only its start day in the block', () => {
  const data = {
    years: [
      {
        year: 2026,
        events: [
          event({ id: 'a', start: '2026-11-09', end: '2026-11-09' }),
          event({ id: 'b', start: '2026-03-30', end: '2026-04-02' }),
          event({ id: 'c', start: '2026-12-30', end: '2027-01-02' }),
          // Same calendar month a year apart: a day span would read as a
          // few days, so the year check must trip on its own.
          event({ id: 'd', start: '2026-01-05', end: '2027-01-08' }),
        ],
      },
    ],
  };
  const blocks = rows(render(data)).map((row) =>
    findAllByType(findByType(row, 'div'), 'span').map(textOf),
  );
  assert.deepEqual(blocks, [
    ['Nov', '9'],
    ['Mar', '30'],
    ['Dec', '30'],
    ['Jan', '5'],
  ]);
});

test("earlier years are linked, newest first, to each year's latest event", () => {
  const tree = render(TWO_YEARS);
  const earlier = findAllByType(tree, 'p').find((p) =>
    /Earlier years/.test(textOf(p)),
  );
  assert.ok(earlier, 'expected an "Earlier years" line');
  const links = findAllByType(earlier, Link);
  assert.deepEqual(
    links.map((link) => [textOf(link), link.props.to]),
    [
      ['2025', '/events/2025/kubecon-na'],
      ['2024', '/events/2024/kubecon-na'],
    ],
  );
  assert.equal(textOf(earlier), 'Earlier years: 2025, 2024');
});

test('with a single year there is no "Earlier years" line', () => {
  const tree = render({ years: [TWO_YEARS.years[0]] });
  const paragraphs = findAllByType(tree, 'p').map(textOf);
  assert.ok(
    paragraphs.every((text) => !/Earlier years/.test(text)),
    'a lone year has nothing earlier to link',
  );
  assert.equal(rows(tree).length, 2);
});

test('with no events at all the component says so instead of rendering a list', () => {
  const tree = render({ years: [] });
  assert.equal(tree.type, 'p');
  assert.match(textOf(tree), /No events have been announced yet/);
  assert.equal(findByType(tree, 'ol'), undefined);
});

test('every element has a key when rendered from a list', () => {
  const tree = render(TWO_YEARS);
  const keyed = [...walkElements(tree, expandAll)].filter(
    (element) => element.key !== null && element.key !== undefined,
  );
  assert.ok(keyed.length >= 4, 'rows and earlier-year links carry keys');
});

test('the component fails loudly when the plugin published nothing', () => {
  // Mirrors the Docusaurus runtime: usePluginData throws for a plugin name
  // with no global data, so a dropped plugin registration cannot render an
  // empty index that looks intentional.
  assert.throws(
    () => EventsIndex(),
    /global data not found for "events-catalog" plugin/,
  );
});

test('nested seeding restores the outer plugin data, not an empty store', () => {
  const outer = { years: [] };
  const restoreOuter = setPluginData(PLUGIN_NAME, outer);
  try {
    const restoreInner = setPluginData(PLUGIN_NAME, {
      years: [{ year: 1, events: [] }],
    });
    restoreInner();
    // The store holds the outer seed again, not the inner one and not nothing.
    assert.equal(EventsIndex().props.years, outer.years);
  } finally {
    restoreOuter();
  }
});

test('the plugin publishes the live catalog grouped by year under its name', () => {
  const plugin = eventsCatalogPlugin({ siteDir });
  assert.equal(plugin.name, PLUGIN_NAME);
  assert.equal(PLUGIN_NAME, 'events-catalog');

  const content = plugin.loadContent();
  assert.deepEqual(content, collectEvents(`${siteDir}docs`));

  let published;
  plugin.contentLoaded({
    content,
    actions: { setGlobalData: (data) => (published = data) },
  });
  assert.deepEqual(published, { years: groupByYear(content) });
});

test('the plugin watches the event pages so the dev server reloads on edits', () => {
  const [pattern, ...rest] = eventsCatalogPlugin({ siteDir }).getPathsToWatch();
  assert.deepEqual(rest, []);
  assert.match(pattern, /\/docs\/events\/\*\*\/\*\.\{md,mdx\}$/);
  assert.ok(pattern.startsWith(siteDir.replace(/\/$/, '')));
});

test('the plugin falls back to the working directory when called without a context', () => {
  // knip's docusaurus plugin invokes inline plugin functions with no
  // arguments to discover their inputs; a plugin that dereferences the
  // context there breaks `npm run check:unused` for the whole config.
  const [pattern] = eventsCatalogPlugin().getPathsToWatch();
  assert.equal(
    pattern,
    join(process.cwd(), 'docs', 'events', '**', '*.{md,mdx}'),
  );
});

test('the live plugin data renders through the component', () => {
  const plugin = eventsCatalogPlugin({ siteDir });
  let published;
  plugin.contentLoaded({
    content: plugin.loadContent(),
    actions: { setGlobalData: (data) => (published = data) },
  });
  const tree = render(published);
  assert.equal(textOf(findByType(tree, 'h2')), String(published.years[0].year));
  assert.equal(rows(tree).length, published.years[0].events.length);
});
