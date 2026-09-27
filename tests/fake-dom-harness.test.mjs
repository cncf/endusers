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
