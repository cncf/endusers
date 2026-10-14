/**
 * Depth-first visit of every node in an mdast tree, parent before children.
 * Shared by the MDX escaper (./mdx-escape.mjs) and the active-content
 * scanner (./mdx-active-content.mjs), which each carried an identical copy.
 *
 * @param {{ children?: Array<object> }} node
 * @param {(node: object) => void} visitor
 */
export function eachNode(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) eachNode(child, visitor);
}
