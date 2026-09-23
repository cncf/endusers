// Minimal stand-in for the handful of DOM APIs useFocusTrap actually touches:
// body.style.overflow, activeElement, add/removeEventListener('keydown'),
// element.focus() and querySelectorAll('button, a[href]'). Keeping it this
// small avoids pulling in a full DOM implementation as a dependency, and makes
// the hook's real contract with the DOM explicit.

function matches(node, selector) {
  const tag = selector.replace(/\[.*\]$/, '').toLowerCase();
  if (node.tagName.toLowerCase() !== tag) return false;
  const attr = selector.match(/\[([^\]]+)\]/)?.[1];
  return attr ? node.getAttribute(attr) !== null : true;
}

/**
 * Installs a fake `document` on globalThis.
 *
 * @param {object} [options]
 * @param {string} [options.overflow] - Initial body.style.overflow value.
 * @returns {object} Handle with createElement/createDialog/dispatchKeyDown/
 *                   setActiveElement/keydownListenerCount/document/restore.
 */
export function installFakeDom({ overflow = '' } = {}) {
  const listeners = new Map();
  const doc = {
    body: { style: { overflow } },
    activeElement: null,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type);
      if (!handlers) return;
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    },
  };

  const hadDocument = 'document' in globalThis;
  const previousDocument = globalThis.document;
  globalThis.document = doc;

  function createElement(tagName, attributes = {}) {
    const node = {
      tagName: tagName.toUpperCase(),
      focusCount: 0,
      getAttribute: (name) => attributes[name] ?? null,
      focus() {
        node.focusCount += 1;
        doc.activeElement = node;
      },
    };
    return node;
  }

  return {
    document: doc,
    createElement,
    /** Builds a container whose querySelectorAll filters the given children. */
    createDialog(children) {
      return {
        tagName: 'DIV',
        querySelectorAll(selector) {
          const parts = selector.split(',').map((part) => part.trim());
          return children.filter((child) =>
            parts.some((part) => matches(child, part)),
          );
        },
      };
    },
    setActiveElement(node) {
      doc.activeElement = node;
    },
    keydownListenerCount: () => (listeners.get('keydown') ?? []).length,
    /** Dispatches a keydown and reports whether preventDefault was called. */
    dispatchKeyDown(init) {
      let defaultPrevented = false;
      const event = {
        shiftKey: false,
        ...init,
        preventDefault() {
          defaultPrevented = true;
        },
      };
      for (const handler of [...(listeners.get('keydown') ?? [])])
        handler(event);
      return { defaultPrevented };
    },
    restore() {
      if (hadDocument) globalThis.document = previousDocument;
      else delete globalThis.document;
    },
  };
}
