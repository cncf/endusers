// Mutation operator library for `npm run test:mutation`.
//
// The coverage gates prove a line ran; they say nothing about whether any
// test would fail if that line changed. This module finds the spans where a
// small edit produces a behaviourally different program -- the mutants --
// and applies exactly one of them on request.
//
// The operator set is the one the hand-filed unpinned-branch findings keep
// hitting: the logical operators (`&&` swapped with `||`), nullish
// coalescing (`??` becomes `||`), equality (`===` swapped with `!==`), the
// ordered comparisons (`<` with `<=`, `>` with `>=`) and the boolean
// literals (`true` with `false`).
//
// Parsing is @swc/core, the same parser tests/tools/jsx-hooks.mjs transpiles
// the JSX sources with, so a mutant span is always a real token: text inside
// strings, template-literal text, regex literals and comments is never a
// candidate, whatever it looks like.

import { parseSync } from '@swc/core';

/** The binary operators mutated, each mapped to its replacement. */
export const BINARY_OPERATORS = new Map([
  ['&&', '||'],
  ['||', '&&'],
  ['??', '||'],
  ['===', '!=='],
  ['!==', '==='],
  ['<', '<='],
  ['<=', '<'],
  ['>', '>='],
  ['>=', '>'],
]);

/** The boolean literals mutated, each mapped to its replacement. */
export const BOOLEAN_LITERALS = new Map([
  ['true', 'false'],
  ['false', 'true'],
]);

// swc spans are 1-based byte offsets; the sources here are ASCII-safe to
// index as UTF-16 because every span boundary comes from the parser.
const toOffset = (spanPoint) => spanPoint - 1;

// The gap between two operands of a binary expression contains only
// whitespace, parentheses, comments and the operator itself, so scanning it
// for the operator needs no full lexer: skip the two comment forms, take the
// first token occurrence outside them. An occurrence inside a comment
// (`a /* && */ && b`) is text, not code, and must not be mutated.
export function findTokenOutsideComments(source, from, to, token) {
  let index = from;
  while (index < to) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      index = end === -1 ? to : end + 1;
    } else if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? to : end + 2;
    } else if (index + token.length <= to && source.startsWith(token, index)) {
      return index;
    } else {
      index += 1;
    }
  }
  return -1;
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

export function lineColumn(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

function walk(node, visit) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node);
  for (const key of Object.keys(node)) {
    if (key !== 'span') walk(node[key], visit);
  }
}

/**
 * Returns every mutant for `source`, sorted by position. Each mutant is
 * `{ kind, start, end, original, replacement, line, column, description }`
 * where `[start, end)` is the span `applyMutant` rewrites.
 *
 * @swc/core parses error-tolerantly nowhere: a source it cannot parse throws,
 * and the caller reports the file as unscoreable rather than mutating a
 * misparse.
 */
export function findMutants(source, { fileName = 'module.mjs' } = {}) {
  const ast = parseSync(source, {
    syntax: 'ecmascript',
    jsx: fileName.endsWith('.js') || fileName.endsWith('.jsx'),
    target: 'es2022',
  });
  const starts = lineStarts(source);
  const mutants = [];
  walk(ast, (node) => {
    if (node.type === 'BinaryExpression') {
      const replacement = BINARY_OPERATORS.get(node.operator);
      if (replacement === undefined) return;
      // The gap between two operands is whitespace, parentheses, comments
      // and the operator itself, so the operator is always found there.
      const start = findTokenOutsideComments(
        source,
        toOffset(node.left.span.end),
        toOffset(node.right.span.start),
        node.operator,
      );
      mutants.push({
        kind: 'binary-operator',
        start,
        end: start + node.operator.length,
        original: node.operator,
        replacement,
      });
    } else if (node.type === 'BooleanLiteral') {
      const start = toOffset(node.span.start);
      const original = node.value ? 'true' : 'false';
      mutants.push({
        kind: 'boolean-literal',
        start,
        end: toOffset(node.span.end),
        original,
        replacement: BOOLEAN_LITERALS.get(original),
      });
    }
  });
  for (const mutant of mutants) {
    const { line, column } = lineColumn(starts, mutant.start);
    mutant.line = line;
    mutant.column = column;
    mutant.description = `replace '${mutant.original}' with '${mutant.replacement}'`;
  }
  return mutants.sort((a, b) => a.start - b.start);
}

/** Returns `source` with exactly `mutant` applied. */
export function applyMutant(source, mutant) {
  return (
    source.slice(0, mutant.start) +
    mutant.replacement +
    source.slice(mutant.end)
  );
}
