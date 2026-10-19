// The swizzled SearchBar (src/theme/SearchBar/index.js) exists for exactly
// one reason: docusaurus-plugin-search-local renders its SearchButton
// without `translations`, hardcoding aria-label="Search (Control+k)" while
// the visible label is "Search" plus the "K" key hint — an accessible name
// that omits visible text, failing WCAG 2.5.3 Label in Name (axe's
// label-content-name-mismatch, #1618). Everything else the component does —
// the highlight effect, the keyboard shortcuts, the ErrorBoundary wrapper —
// is copied from the plugin so the swizzle changes nothing but the label,
// and each copied behaviour is pinned here so the copy cannot drift away
// from it.
//
// The component calls useState/useEffect and reads window, document and the
// query string, so it is driven through tests/tools/react-hook-driver.mjs
// with a fake window/document installed per test, exactly as
// tests/use-focus-trap.test.mjs drives its hook. The plugin's own
// SearchButton, SearchModal and ErrorBoundary arrive as the marker stubs
// under tests/tools/theme-stubs/, and mark.js as the recording stub under
// tests/tools/package-stubs/ — what is asserted is the props and calls the
// swizzled component makes, never the plugin's internals.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import { renderHook } from './tools/react-hook-driver.mjs';
import { findByType } from './tools/react-element-tree.mjs';
import ExecutionEnvironment from './tools/docusaurus-stubs/ExecutionEnvironment.mjs';
import { setLocationSearch } from './tools/docusaurus-stubs/router.mjs';
import { setPluginData } from './tools/docusaurus-stubs/useGlobalData.mjs';
import Mark from './tools/package-stubs/mark.js.mjs';
import SearchModal from './tools/theme-stubs/SearchModal.mjs';
import ErrorBoundary from './tools/theme-stubs/ErrorBoundary.mjs';
import { SearchButton } from './tools/theme-stubs/SearchBar/SearchButton.mjs';

const { default: SearchBarWrapper, SearchBar } = await importSource(
  'src/theme/SearchBar/index.js',
);

// A minimal keydown-targeting window, kept local to this suite for the same
// reason tests/tools/fake-dom.mjs stays minimal: the contract under test is
// "attaches one keydown listener, removes it on re-render and unmount".
const listeners = [];
const hadWindow = 'window' in globalThis;
const previousWindow = globalThis.window;
const hadDocument = 'document' in globalThis;
const previousDocument = globalThis.document;

let queriedRoot = null;

globalThis.window = {
  addEventListener(type, handler) {
    if (type === 'keydown') listeners.push(handler);
  },
  removeEventListener(type, handler) {
    const index = listeners.indexOf(handler);
    if (index !== -1) listeners.splice(index, 1);
  },
};
globalThis.document = {
  querySelector(selector) {
    return selector === 'article' ? queriedRoot : null;
  },
};

function dispatchKeyDown(init) {
  let defaultPrevented = false;
  const event = {
    key: undefined,
    keyCode: undefined,
    metaKey: false,
    ctrlKey: false,
    target: { tagName: 'DIV', isContentEditable: false },
    ...init,
    preventDefault() {
      defaultPrevented = true;
    },
  };
  for (const handler of [...listeners]) handler(event);
  return defaultPrevented;
}

function renderSearchBar() {
  return renderHook(() => SearchBar());
}

function renderedButton(api) {
  const button = findByType(api.result, SearchButton);
  assert.ok(button, 'expected the search button in the tree');
  return button;
}

afterEach(() => {
  listeners.length = 0;
  queriedRoot = null;
  Mark.instances.length = 0;
  setPluginData({});
  setLocationSearch('');
  ExecutionEnvironment.canUseDOM = true;
});

test.after(() => {
  if (hadWindow) globalThis.window = previousWindow;
  else delete globalThis.window;
  if (hadDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test('the default export wraps SearchBar in the plugin ErrorBoundary', () => {
  // The plugin ships this exact wrapper so a render error in search cannot
  // take the navbar down; the swizzle keeps it.
  const tree = new SearchBarWrapper().render();
  assert.equal(tree.type, ErrorBoundary);
  const inner = findByType(tree, SearchBar);
  assert.ok(inner, 'expected SearchBar inside the ErrorBoundary');
  assert.equal(
    ErrorBoundary({ children: 'child' }),
    'child',
    'the stub passes children through',
  );
});

test('the button gets an accessible name containing its visible text', () => {
  // WCAG 2.5.3: the visible label is "Search" plus the key hint "K", so the
  // accessible name must contain both. The plugin appends the shortcut to
  // buttonAriaLabel, producing aria-label="Search K (Control+k)".
  const api = renderSearchBar();
  const { translations } = renderedButton(api).props;
  assert.deepEqual(translations, {
    buttonText: 'Search ',
    buttonAriaLabel: 'Search K',
  });

  // The contract the way axe-core's label-content-name-mismatch evaluates
  // it: both strings are tokenised (parentheticals dropped, punctuation
  // stripped) and the visible-text tokens must appear in the accessible
  // name as a contiguous run. The trailing space in buttonText is what
  // stops the placeholder and the key hint concatenating into the single
  // token "SearchK" — trim it and this assertion fails.
  const tokens = (text) =>
    text
      .toLowerCase()
      .replace(/\([^()]*\)/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const visible = tokens(`${translations.buttonText}K`);
  const name = tokens(
    `${translations.buttonAriaLabel} (Control+k)`,
    // The plugin's aria-label template: `${buttonAriaLabel} (${shortcut})`.
  );
  const contained = name.some(
    (_, i) =>
      i + visible.length <= name.length &&
      visible.every((word, j) => word === name[i + j]),
  );
  assert.ok(
    contained,
    `visible tokens [${visible}] must be a contiguous run in name [${name}]`,
  );
});

test('the stubbed plugin components render nothing on their own', () => {
  // Marker-stub coverage: the assertions everywhere else in this file read
  // element identity and props, so a stub that rendered anything would only
  // ever confuse a tree walk.
  assert.equal(SearchButton(), null);
  assert.equal(SearchModal(), null);
});

test('the modal is closed until the button is clicked', () => {
  const api = renderSearchBar();
  assert.equal(findByType(api.result, SearchModal), undefined);

  renderedButton(api).props.onClick();
  assert.ok(findByType(api.result, SearchModal), 'click must open the modal');
});

test('the modal onClose closes it again', () => {
  const api = renderSearchBar();
  renderedButton(api).props.onClick();
  const modal = findByType(api.result, SearchModal);
  modal.props.onClose();
  assert.equal(findByType(api.result, SearchModal), undefined);
});

test('Ctrl+K opens the modal and prevents the default', () => {
  const api = renderSearchBar();
  assert.equal(dispatchKeyDown({ key: 'k', ctrlKey: true }), true);
  assert.ok(findByType(api.result, SearchModal));
});

test('Cmd+K closes the modal when it is open', () => {
  const api = renderSearchBar();
  renderedButton(api).props.onClick();
  assert.equal(dispatchKeyDown({ key: 'k', metaKey: true }), true);
  assert.equal(findByType(api.result, SearchModal), undefined);
});

test('Escape closes the modal only when it is open', () => {
  const api = renderSearchBar();
  assert.equal(
    dispatchKeyDown({ key: 'Escape', keyCode: 27 }),
    false,
    'Escape with a closed modal must not prevent the default',
  );

  renderedButton(api).props.onClick();
  assert.equal(dispatchKeyDown({ key: 'Escape', keyCode: 27 }), true);
  assert.equal(findByType(api.result, SearchModal), undefined);
});

test('a bare "k" keystroke does nothing', () => {
  const api = renderSearchBar();
  assert.equal(dispatchKeyDown({ key: 'k' }), false);
  assert.equal(findByType(api.result, SearchModal), undefined);
});

test('"/" opens the modal from outside an editing control', () => {
  const api = renderSearchBar();
  assert.equal(dispatchKeyDown({ key: '/' }), true);
  assert.ok(findByType(api.result, SearchModal));
});

test('"/" does not close the modal once it is open', () => {
  // The plugin's own comment: "/" is a character, so it opens but never
  // closes — otherwise typing it into the open search box would toggle.
  const api = renderSearchBar();
  renderedButton(api).props.onClick();
  assert.equal(dispatchKeyDown({ key: '/' }), false);
  assert.ok(findByType(api.result, SearchModal), 'modal must stay open');
});

test('"/" never hijacks typing into an editing control', () => {
  for (const target of [
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'SELECT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    const api = renderSearchBar();
    assert.equal(
      dispatchKeyDown({ key: '/', target }),
      false,
      `"/" with focus in ${target.tagName} must not be intercepted`,
    );
    assert.equal(findByType(api.result, SearchModal), undefined);
    api.unmount();
  }
});

test('an unrelated key does nothing', () => {
  const api = renderSearchBar();
  assert.equal(dispatchKeyDown({ key: 'x', keyCode: 88 }), false);
  assert.equal(findByType(api.result, SearchModal), undefined);
});

test('the keydown listener is removed on unmount', () => {
  const api = renderSearchBar();
  assert.equal(listeners.length, 1);
  api.unmount();
  assert.equal(listeners.length, 0, 'unmount must detach the listener');
});

test('the highlight effect does nothing when the plugin option is off', () => {
  setPluginData({ highlightSearchTermsOnTargetPage: false });
  setLocationSearch('?_highlight=alpha');
  queriedRoot = {};
  renderSearchBar();
  assert.deepEqual(Mark.instances, []);
});

test('search terms in the query string are highlighted on the article', () => {
  setPluginData({ highlightSearchTermsOnTargetPage: true });
  setLocationSearch('?_highlight=alpha&_highlight=beta');
  queriedRoot = { tagName: 'ARTICLE' };

  renderSearchBar();

  assert.equal(Mark.instances.length, 1, 'expected one Mark over the root');
  const [instance] = Mark.instances;
  assert.equal(instance.root, queriedRoot);
  assert.deepEqual(instance.calls, [
    'unmark',
    ['mark', ['alpha', 'beta']],
  ]);
});

test('the highlight effect reads no query string off the DOM', () => {
  // Server-side (or pre-hydration) there is no location to read, so the
  // effect must behave as if no highlight parameters were present.
  setPluginData({ highlightSearchTermsOnTargetPage: true });
  setLocationSearch('?_highlight=alpha');
  queriedRoot = { tagName: 'ARTICLE' };
  ExecutionEnvironment.canUseDOM = false;

  renderSearchBar();

  assert.deepEqual(Mark.instances, []);
});

test('the highlight effect stops when no highlight parameter is present', () => {
  setPluginData({ highlightSearchTermsOnTargetPage: true });
  setLocationSearch('?unrelated=1');
  queriedRoot = { tagName: 'ARTICLE' };

  renderSearchBar();

  assert.deepEqual(Mark.instances, []);
});

test('the highlight effect stops when the page has no article root', () => {
  setPluginData({ highlightSearchTermsOnTargetPage: true });
  setLocationSearch('?_highlight=alpha');
  queriedRoot = null;

  renderSearchBar();

  assert.deepEqual(Mark.instances, []);
});

test('navigating re-runs the highlight effect for the new query string', () => {
  setPluginData({ highlightSearchTermsOnTargetPage: true });
  setLocationSearch('?_highlight=alpha');
  queriedRoot = { tagName: 'ARTICLE' };
  const api = renderSearchBar();
  assert.equal(Mark.instances.length, 1);

  setLocationSearch('?_highlight=beta');
  api.rerender();

  assert.equal(Mark.instances.length, 2, 'a new search must re-highlight');
  assert.deepEqual(Mark.instances[1].calls, ['unmark', ['mark', ['beta']]]);
});
