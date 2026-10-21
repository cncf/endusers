// Unit tests for the mutation operator library.
//
// The contract that matters: a mutant span is always a real token in code,
// never text inside a string, template literal, regex literal or comment --
// and applying it rewrites exactly that token.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BINARY_OPERATORS,
  BOOLEAN_LITERALS,
  applyMutant,
  findMutants,
  findTokenOutsideComments,
  lineColumn,
} from './tools/mutation-operators.mjs';

test('the operator tables pin exactly the intended mutations', () => {
  assert.deepEqual(Object.fromEntries(BINARY_OPERATORS), {
    '&&': '||',
    '||': '&&',
    '??': '||',
    '===': '!==',
    '!==': '===',
    '<': '<=',
    '<=': '<',
    '>': '>=',
    '>=': '>',
  });
  assert.deepEqual(Object.fromEntries(BOOLEAN_LITERALS), {
    true: 'false',
    false: 'true',
  });
});

test('every binary operator mutates to its counterpart in place', () => {
  for (const [operator, replacement] of BINARY_OPERATORS) {
    const source = `const r = a ${operator} b;\n`;
    const mutants = findMutants(source, { fileName: 'x.mjs' });
    assert.equal(mutants.length, 1, operator);
    const [mutant] = mutants;
    assert.equal(mutant.kind, 'binary-operator');
    assert.equal(mutant.original, operator);
    assert.equal(mutant.replacement, replacement);
    assert.equal(mutant.line, 1);
    assert.equal(mutant.column, 13);
    assert.equal(
      mutant.description,
      `replace '${operator}' with '${replacement}'`,
    );
    assert.equal(
      applyMutant(source, mutant),
      `const r = a ${replacement} b;\n`,
      operator,
    );
  }
});

test('boolean literals mutate to each other', () => {
  const source = 'export const g = (x) => (x ? true : false);\n';
  const mutants = findMutants(source, { fileName: 'x.mjs' });
  assert.deepEqual(
    mutants.map(({ original, replacement, kind }) => [
      original,
      replacement,
      kind,
    ]),
    [
      ['true', 'false', 'boolean-literal'],
      ['false', 'true', 'boolean-literal'],
    ],
  );
  assert.equal(applyMutant(source, mutants[0]).includes('false : false'), true);
});

test('operators inside strings, templates, regexes and comments are text', () => {
  const source = [
    'const s = "a && b";',
    "const t = 'c === d';",
    'const u = `e || f`;',
    'const r = /g < h/;',
    '// i !== j',
    '/* k ?? l */',
    'export const m = 1;',
    '',
  ].join('\n');
  assert.deepEqual(findMutants(source, { fileName: 'x.mjs' }), []);
});

test('expressions inside template substitutions are code and mutate', () => {
  const source = 'const t = `value: ${i !== j}`;\n';
  const mutants = findMutants(source, { fileName: 'x.mjs' });
  assert.equal(mutants.length, 1);
  assert.equal(mutants[0].original, '!==');
  assert.equal(
    applyMutant(source, mutants[0]),
    'const t = `value: ${i === j}`;\n',
  );
});

test('operators outside the table are left alone', () => {
  const source =
    'const r = (a + b) * c - d / e; const i = f instanceof G;\nlet uninit;\n';
  assert.deepEqual(findMutants(source, { fileName: 'x.mjs' }), []);
});

test('an operator inside a comment in the operand gap is not the mutant span', () => {
  const source = 'const h = q /* || */ || p;\n';
  const mutants = findMutants(source, { fileName: 'x.mjs' });
  assert.equal(mutants.length, 1);
  assert.equal(applyMutant(source, mutants[0]), 'const h = q /* || */ && p;\n');
});

test('mutants carry their true line and column, sorted by position', () => {
  const source = 'const a = x && y;\nconst b = true;\nconst c = p < q;\n';
  const mutants = findMutants(source, { fileName: 'x.mjs' });
  assert.deepEqual(
    mutants.map(({ line, column }) => [line, column]),
    [
      [1, 13],
      [2, 11],
      [3, 13],
    ],
  );
});

test('findMutants takes its defaults when no options are given', () => {
  const mutants = findMutants('const a = x && y;\n');
  assert.equal(mutants.length, 1);
  assert.deepEqual(findMutants('const a = x && y;\n', {}), mutants);
});

test('JSX sources parse as JSX and mutate inside expressions', () => {
  const source = 'export const el = <div className="a">{ok && <b />}</div>;\n';
  for (const fileName of ['x.js', 'x.jsx']) {
    const mutants = findMutants(source, { fileName });
    assert.deepEqual(
      mutants.map(({ original }) => original),
      ['&&'],
      fileName,
    );
  }
});

test('JSX syntax in a non-JSX file is a parse error, not a misparse', () => {
  assert.throws(() =>
    findMutants('const el = <div>{x}</div>;\n', { fileName: 'x.mjs' }),
  );
});

test('findTokenOutsideComments skips line and block comments', () => {
  const source = 'a // &&\n b /* && */ && c';
  assert.equal(findTokenOutsideComments(source, 0, source.length, '&&'), 20);
});

test('findTokenOutsideComments reports -1 when the token is absent or only in comments', () => {
  assert.equal(findTokenOutsideComments('a b c', 0, 5, '&&'), -1);
  assert.equal(findTokenOutsideComments('a /* &&', 0, 8, '&&'), -1);
  assert.equal(findTokenOutsideComments('a // &&', 0, 7, '&&'), -1);
  assert.equal(findTokenOutsideComments('a /* && */', 0, 10, '&&'), -1);
});

test('findTokenOutsideComments honours the to boundary', () => {
  const source = 'a && b';
  assert.equal(findTokenOutsideComments(source, 0, source.length, '&&'), 2);
  assert.equal(findTokenOutsideComments(source, 0, 3, '&&'), -1);
});

test('lineColumn walks the line-start table in both directions', () => {
  const starts = [0, 10, 25];
  assert.deepEqual(lineColumn(starts, 0), { line: 1, column: 1 });
  assert.deepEqual(lineColumn(starts, 9), { line: 1, column: 10 });
  assert.deepEqual(lineColumn(starts, 10), { line: 2, column: 1 });
  assert.deepEqual(lineColumn(starts, 20), { line: 2, column: 11 });
  assert.deepEqual(lineColumn(starts, 25), { line: 3, column: 1 });
  assert.deepEqual(lineColumn([0], 3), { line: 1, column: 4 });
});
