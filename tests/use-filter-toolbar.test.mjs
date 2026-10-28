// Unit contract for src/components/shared/useFilterToolbar.js, the hook
// CaseStudies, MemberDirectory and ArchitectureFilters all now share for their
// per-field filter state, active-filter count and "Clear filters" reset.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import { renderHook } from './tools/react-hook-driver.mjs';

const { useFilterToolbar } = await importSource(
  'src/components/shared/useFilterToolbar.js',
);

const ITEMS = [
  { name: 'Acme', tag: 'retail' },
  { name: 'Globex', tag: 'manufacturing' },
];

function byTagAndName(items, filters) {
  return items.filter((item) => {
    if (filters.tag && item.tag !== filters.tag) return false;
    if (
      filters.query &&
      !item.name.toLowerCase().includes(filters.query.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

const DEFAULT_FILTERS = { query: '', tag: '' };

test('returns every item and zero active filters before anything is set', () => {
  const { result } = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  assert.deepEqual(result.filters, DEFAULT_FILTERS);
  assert.equal(result.filtered.length, 2);
  assert.equal(result.activeCount, 0);
});

test('setFilter updates one field, narrows the filtered list and counts as active', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  hook.result.setFilter('tag', 'retail');
  const after = hook.rerender();

  assert.equal(after.filters.tag, 'retail');
  assert.deepEqual(
    after.filtered.map((item) => item.name),
    ['Acme'],
  );
  assert.equal(after.activeCount, 1);
});

// Every other case in this file sets `query` to 'acme' beside a tag filter
// that has already narrowed the list to Acme, so the predicate's query arm
// only ever accepted. Until these two cases, nothing asserted that a query
// reaching `filtered` removes anything: the hook could have dropped the field
// before calling the predicate and every assertion above would still pass,
// because `activeCount` is derived from `filters` rather than from the
// filtered list.
test('a query alone narrows the filtered list', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  hook.result.setFilter('query', 'globex');
  const after = hook.rerender();

  assert.deepEqual(
    after.filtered.map((item) => item.name),
    ['Globex'],
  );
  assert.equal(after.activeCount, 1);
});

test('a query that matches no item filters everything out', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  hook.result.setFilter('query', 'initech');
  const after = hook.rerender();

  assert.deepEqual(after.filtered, []);
  assert.equal(after.activeCount, 1);
});

test('a query that is only whitespace does not count as an active filter', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  hook.result.setFilter('query', '   ');
  const after = hook.rerender();

  assert.equal(after.activeCount, 0);
});

test('a boolean filter field counts as active only when true', () => {
  const booleanDefaults = { query: '', flagged: false };
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, booleanDefaults, (items) => items),
  );
  assert.equal(hook.result.activeCount, 0);

  hook.result.setFilter('flagged', true);
  const after = hook.rerender();
  assert.equal(after.activeCount, 1);

  after.setFilter('flagged', false);
  const reset = hook.rerender();
  assert.equal(reset.activeCount, 0);
});

test('setting multiple fields raises the active count accordingly', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  hook.result.setFilter('tag', 'retail');
  hook.rerender();
  hook.result.setFilter('query', 'acme');
  const after = hook.rerender();

  assert.equal(after.activeCount, 2);
});

test('clearFilters resets every field back to its initial value', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, DEFAULT_FILTERS, byTagAndName),
  );
  hook.result.setFilter('tag', 'retail');
  hook.result.setFilter('query', 'acme');
  hook.rerender();
  hook.result.clearFilters();
  const after = hook.rerender();

  assert.deepEqual(after.filters, DEFAULT_FILTERS);
  assert.equal(after.activeCount, 0);
  assert.equal(after.filtered.length, 2);
});

test('a list-valued filter is active only while it holds an entry', () => {
  const hook = renderHook(() =>
    useFilterToolbar(ITEMS, { query: '', tags: [] }, (items) => items),
  );
  assert.equal(hook.result.activeCount, 0);

  hook.result.setFilter('tags', ['retail']);
  assert.equal(hook.result.activeCount, 1);

  hook.result.setFilter('tags', []);
  assert.equal(hook.result.activeCount, 0);
});
