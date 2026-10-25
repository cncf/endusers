// Minimal helpers for asserting on the React element tree a component returns.
//
// A React element is a plain object, so a presentational component can be
// called directly and its output walked — no renderer, no DOM and no extra
// dependency. Components that call hooks other than the ones stubbed by
// ./react-hook-driver.mjs are out of scope for this helper.

/**
 * Depth-first walk over an element tree, yielding every React element.
 *
 * `options.expand` opts into rendering nested function components inline:
 * when it returns true for an element's `type`, the walker calls the
 * component with its props and descends into the returned tree. Only
 * hook-free components may be expanded this way — a component that calls
 * hooks throws outside a hook dispatcher, so leave those as leaves.
 *
 * @param {any} node a React element, array, or primitive child
 * @param {object} [options]
 * @param {(type: Function) => boolean} [options.expand] predicate selecting
 *   which function components to render and descend into
 * @returns {Generator<any>} every element in document order
 */
export function* walkElements(node, { expand } = {}) {
  // `null` is the only non-element this guard has to catch: `typeof null` is
  // `'object'`, so without it the `node.type` read below would throw. Every
  // other non-element child React allows — `undefined`, a boolean, a string,
  // a number — fails the `typeof node !== 'object'` test instead and returns
  // there, so naming them here as well would add branches nothing can observe.
  if (node === null) return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walkElements(child, { expand });
    return;
  }
  if (typeof node !== 'object' || node.type === undefined) return;
  yield node;
  if (typeof node.type === 'function' && expand?.(node.type)) {
    yield* walkElements(node.type(node.props), { expand });
    return;
  }
  yield* walkElements(node.props?.children, { expand });
}

/**
 * Renders one function-component element one level deep, the way React
 * would — without a renderer. Only hook-free components may be rendered
 * this way.
 *
 * @param {any} element a React element whose `type` is a function component
 * @param {object} [propsOverride] props to render with instead of the
 *   element's own
 * @returns {any} the element tree the component returns
 */
export function renderElement(element, propsOverride) {
  if (typeof element?.type !== 'function') {
    throw new TypeError(
      'renderElement expects an element whose type is a function component',
    );
  }
  return element.type(propsOverride ?? element.props);
}

/**
 * @param {any} tree root element
 * @param {string|Function} type intrinsic tag name or component function
 * @param {object} [options] forwarded to walkElements (e.g. `expand`)
 * @returns {any[]} every element of that type, in document order
 */
export function findAllByType(tree, type, options) {
  return [...walkElements(tree, options)].filter(
    (element) => element.type === type,
  );
}

/**
 * @param {any} tree root element
 * @param {string|Function} type intrinsic tag name or component function
 * @param {object} [options] forwarded to walkElements (e.g. `expand`)
 * @returns {any} the first element of that type, or undefined
 */
export function findByType(tree, type, options) {
  return findAllByType(tree, type, options)[0];
}

/**
 * Concatenates every string/number leaf under an element, like textContent.
 *
 * @param {any} node a React element, array, or primitive child
 * @returns {string} the visible text
 */
export function textOf(node) {
  // As in walkElements, `null` is the only case worth naming: it is the one
  // non-element whose `typeof` is `'object'`, so it would otherwise reach the
  // `node.props` read below. `undefined` and booleans fall through every test
  // here and leave by the final `return ''`.
  if (node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return textOf(node.props?.children);
  return '';
}
