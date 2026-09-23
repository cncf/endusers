// Minimal helpers for asserting on the React element tree a component returns.
//
// A React element is a plain object, so a presentational component can be
// called directly and its output walked — no renderer, no DOM and no extra
// dependency. Components that call hooks other than the ones stubbed by
// ./react-hook-driver.mjs are out of scope for this helper.

/**
 * Depth-first walk over an element tree, yielding every React element.
 *
 * @param {any} node a React element, array, or primitive child
 * @returns {Generator<any>} every element in document order
 */
export function* walkElements(node) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walkElements(child);
    return;
  }
  if (typeof node !== 'object' || node.type === undefined) return;
  yield node;
  yield* walkElements(node.props?.children);
}

/**
 * @param {any} tree root element
 * @param {string|Function} type intrinsic tag name or component function
 * @returns {any[]} every element of that type, in document order
 */
export function findAllByType(tree, type) {
  return [...walkElements(tree)].filter((element) => element.type === type);
}

/**
 * @param {any} tree root element
 * @param {string|Function} type intrinsic tag name or component function
 * @returns {any} the first element of that type, or undefined
 */
export function findByType(tree, type) {
  return findAllByType(tree, type)[0];
}

/**
 * Concatenates every string/number leaf under an element, like textContent.
 *
 * @param {any} node a React element, array, or primitive child
 * @returns {string} the visible text
 */
export function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return textOf(node.props?.children);
  return '';
}
