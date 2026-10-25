// tests/tools/fake-dom.mjs is the stand-in document every focus-trap test
// mounts against. The branches pinned here are the ones the focus-trap suite
// never reaches, because that suite only ever registers one keydown listener
// and only ever runs where no global document exists. A regression in them
// would surface as a confusing failure in an unrelated suite, or as a leaked
// global document that quietly changes how a later test behaves.

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from './tools/fake-dom.mjs';

test('removing a listener for an unregistered type is a no-op', () => {
  // A hook that tears down a listener type it never added must not throw:
  // the fake document has to be as forgiving as the real one.
  const dom = installFakeDom();
  try {
    assert.doesNotThrow(() =>
      dom.document.removeEventListener('click', () => {}),
    );

    const handler = () => {};
    dom.document.addEventListener('keydown', handler);
    assert.equal(dom.keydownListenerCount(), 1);

    // A handler that was never added leaves the registered one in place.
    dom.document.removeEventListener('keydown', () => {});
    assert.equal(dom.keydownListenerCount(), 1);

    dom.document.removeEventListener('keydown', handler);
    assert.equal(dom.keydownListenerCount(), 0);
  } finally {
    dom.restore();
  }
});

test('a document with no keydown listener counts and dispatches as empty', () => {
  // Suites assert keydownListenerCount() === 0 after unmount to prove the
  // trap detached. If the count threw, or dispatching crashed, on a document
  // that never saw a listener, that assertion could never be made.
  const dom = installFakeDom();
  try {
    assert.equal(dom.keydownListenerCount(), 0);
    assert.deepEqual(dom.dispatchKeyDown({ key: 'Escape' }), {
      defaultPrevented: false,
    });
  } finally {
    dom.restore();
  }
});

test('restore puts back a document that existed before the install', () => {
  // Under a DOM-providing runner globalThis.document is already set. restore()
  // must hand that object back rather than delete the global, or every test
  // that ran after the first fake install would see no document at all.
  const previous = { marker: 'pre-existing' };
  globalThis.document = previous;
  try {
    const dom = installFakeDom();
    assert.notEqual(globalThis.document, previous);
    assert.equal(globalThis.document, dom.document);

    dom.restore();
    assert.equal(globalThis.document, previous);
    assert.ok('document' in globalThis);
  } finally {
    delete globalThis.document;
  }
});

test('restore deletes the global when no document existed before', () => {
  assert.equal('document' in globalThis, false);
  const dom = installFakeDom();
  assert.equal(globalThis.document, dom.document);
  dom.restore();
  assert.equal('document' in globalThis, false);
});

test('a freshly installed document starts with no body overflow set', () => {
  // useFocusTrap restores body.style.overflow to whatever it found. The suites
  // install with an explicit overflow, so nothing pins the default; if it
  // seeded a non-empty string the hook would appear to restore a scroll lock
  // that was never there.
  const dom = installFakeDom();
  try {
    assert.equal(dom.document.body.style.overflow, '');
  } finally {
    dom.restore();
  }
});

test('a second listener for a type joins the first rather than replacing it', () => {
  // The focus-trap suite only ever registers one keydown listener, so nothing
  // proves the registry appends. A fake that reset the list on every add would
  // silently drop a listener and make a two-trap regression invisible.
  const dom = installFakeDom();
  try {
    const seen = [];
    dom.document.addEventListener('keydown', () => seen.push('first'));
    dom.document.addEventListener('keydown', () => seen.push('second'));

    assert.equal(dom.keydownListenerCount(), 2);
    dom.dispatchKeyDown({ key: 'Escape' });
    assert.deepEqual(seen, ['first', 'second']);
  } finally {
    dom.restore();
  }
});

test('createElement upper-cases tagName and reads back its attributes', () => {
  // matches() compares lower-cased tag names, so a createElement that stored
  // the tag verbatim would still pass every selector assertion while reporting
  // a tagName no real DOM node has. getAttribute has to distinguish an absent
  // attribute (null) from a present one, which is the whole of the a[href]
  // selector contract below.
  const dom = installFakeDom();
  try {
    const link = dom.createElement('a', { href: '/members' });
    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('href'), '/members');
    assert.equal(link.getAttribute('target'), null);
    assert.equal(dom.createElement('button').getAttribute('href'), null);
  } finally {
    dom.restore();
  }
});

test('a dialog is a DIV whose querySelectorAll filters by tag and attribute', () => {
  // useFocusTrap asks for 'button, a[href]' and focuses the first match, so the
  // selector has to exclude a child of another tag and an <a> with no href. A
  // fake that returned every child would hand the hook an unfocusable node and
  // make the trap look broken; one that ignored the attribute group would focus
  // an anchor the browser skips.
  const dom = installFakeDom();
  try {
    const button = dom.createElement('button');
    const link = dom.createElement('a', { href: '/members' });
    const bareLink = dom.createElement('a');
    const span = dom.createElement('span');
    const dialog = dom.createDialog([span, button, bareLink, link]);

    assert.equal(dialog.tagName, 'DIV');
    assert.deepEqual(dialog.querySelectorAll('button, a[href]'), [
      button,
      link,
    ]);
    assert.deepEqual(dialog.querySelectorAll('button'), [button]);
    assert.deepEqual(dialog.querySelectorAll('a[href]'), [link]);
    assert.deepEqual(dialog.querySelectorAll('input'), []);
  } finally {
    dom.restore();
  }
});
