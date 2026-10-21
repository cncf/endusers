// Contract for tests/tools/mutation-operators.mjs.
//
// The mask is the part that has to be right: an operator applied inside a
// string, a comment, a regex body or a template chunk would produce a mutant
// that changes no behaviour, and the runner would then score a survivor that
// means nothing. Every masked construct is asserted both ways round -- the
// text inside is not mutated, and the code either side of it still is.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPERATORS,
  applyMutant,
  describeMutant,
  maskNonCode,
  mutantsFor,
} from './tools/mutation-operators.mjs';

function operatorsAt(source) {
  return mutantsFor(source).map(
    (mutant) => `${mutant.original}->${mutant.replacement}`,
  );
}

test('the mask keeps the source length and every newline in place', () => {
  const source = "const a = 'x';\n// y\nconst b = `z`;\n";
  const masked = maskNonCode(source);
  assert.equal(masked.length, source.length);
  assert.deepEqual(
    [...masked].map((character, index) => character === '\n'),
    [...source].map((character) => character === '\n'),
    'a blanked newline would shift every line number the runner reports',
  );
});

test('operators inside single- and double-quoted strings are not mutated', () => {
  assert.deepEqual(operatorsAt("const a = 'x && y';"), []);
  assert.deepEqual(operatorsAt('const a = "x === y";'), []);
});

test('an escaped quote does not end the string it appears in', () => {
  // Without escape handling the scan would close at the inner quote and read
  // the `&&` that follows as code.
  assert.deepEqual(operatorsAt("const a = 'it\\'s && here';"), []);
});

test('an unterminated string masks to the end of the file', () => {
  assert.deepEqual(operatorsAt("const a = 'x && y"), []);
});

test('operators inside line and block comments are not mutated', () => {
  assert.deepEqual(operatorsAt('// a && b\n'), []);
  assert.deepEqual(operatorsAt('/* a === b */\n'), []);
});

test('a line comment with no trailing newline masks to the end of the file', () => {
  assert.deepEqual(operatorsAt('const a = 1;\n// a && b'), []);
});

test('an unterminated block comment masks to the end of the file', () => {
  assert.deepEqual(operatorsAt('/* a && b'), []);
});

test('code after a comment is still mutated', () => {
  assert.deepEqual(operatorsAt('// a && b\nconst c = d && e;'), ['&&->||']);
  assert.deepEqual(operatorsAt('/* a && b */ const c = d && e;'), ['&&->||']);
});

test('template chunks are masked but their substitutions are code', () => {
  assert.deepEqual(operatorsAt('const a = `x && y`;'), []);
  assert.deepEqual(operatorsAt('const a = `x ${b && c} y`;'), ['&&->||']);
});

test('an escape inside a template does not end it', () => {
  assert.deepEqual(operatorsAt('const a = `x \\` && y`;'), []);
});

test('a template nested inside a substitution returns to the outer template', () => {
  assert.deepEqual(operatorsAt('const a = `${`i && j`} && k`;'), []);
  assert.deepEqual(operatorsAt('const a = `${b(`i`) && c} && k`;'), ['&&->||']);
});

test('a brace inside a substitution does not end the substitution early', () => {
  assert.deepEqual(operatorsAt('const a = `${{ b: c && d }} && e`;'), [
    '&&->||',
  ]);
});

test('a regex body is masked and the code around it is not', () => {
  assert.deepEqual(operatorsAt('const a = /x && y/.test(z);'), []);
  assert.deepEqual(operatorsAt('const a = /x/.test(z) && w;'), ['&&->||']);
});

test('a slash inside a regex character class does not close it', () => {
  assert.deepEqual(operatorsAt('const a = /[/&&]x/.test(z);'), []);
  // The class closes, so the trailing `&&` after the literal is code again.
  assert.deepEqual(operatorsAt('const a = /[/]/.test(z) && w;'), ['&&->||']);
});

test('an escape inside a regex does not close it', () => {
  assert.deepEqual(operatorsAt('const a = /x\\/ && y/.test(z);'), []);
});

test('regex flags are skipped rather than read as code', () => {
  assert.deepEqual(operatorsAt('const a = /x/gi.test(y) && z;'), ['&&->||']);
});

test('division is not read as the start of a regex literal', () => {
  // Each of these ends a value, so the `/` after it divides. If it opened a
  // regex instead, the `&&` later on the line would be masked.
  for (const expression of [
    'const a = b / c && d;',
    'const a = f(b) / 2 && d;',
    'const a = b[0] / 2 && d;',
    "const a = 'b'.length / 2 && d;",
    "const a = 'b' / 2 && d;",
    'const a = "b" / 2 && d;',
    'const a = `b` / 2 && d;',
  ]) {
    assert.deepEqual(operatorsAt(expression), ['&&->||'], expression);
  }
});

test('a regex is still recognised after a keyword and at the start of a file', () => {
  assert.deepEqual(operatorsAt('function f() {\n  return /a && b/;\n}\n'), []);
  assert.deepEqual(operatorsAt('/a && b/.test(c);'), []);
});

test('a slash with no closing slash on the line is division, not a regex', () => {
  assert.deepEqual(operatorsAt('const a = (b) / c && d;'), ['&&->||']);
  assert.deepEqual(operatorsAt('const a = 1;\nconst b = a && 2;\n'), [
    '&&->||',
  ]);
});

test('an unterminated regex leaves the rest of the file as code', () => {
  assert.deepEqual(operatorsAt('const a = b === c;\nconst d = /e'), [
    '===->!==',
  ]);
});

test('every operator in the table produces its mutant', () => {
  const source = [
    'const a = b && c;',
    'const d = e || f;',
    'const g = h ?? i;',
    'const j = k === l;',
    'const m = n !== o;',
    'const p = q <= r;',
    'const s = t < u;',
    'const v = w >= x;',
    'const y = z > aa;',
    'const ab = true;',
    'const ac = false;',
  ].join('\n');
  assert.deepEqual(
    new Set(mutantsFor(source).map((mutant) => mutant.operator)),
    new Set(OPERATORS.map((operator) => operator.name)),
  );
});

test('JSX punctuation and arrows are left alone', () => {
  // `<` in a tag, `/>` in a self-closing tag and `>` in `=>` all become
  // unparsable if mutated, so none of them may be matched in the first place.
  const source =
    'const a = (b) => <div className="c" {...d}>{b}</div>;\n' +
    'const e = <br />;\nconst f = g >> 1;\nconst h = i << 2;\n';
  assert.deepEqual(mutantsFor(source), []);
});

test('mutants are reported in source order with 1-based line and column', () => {
  const source = 'const a = 1;\nconst b = c === d && e;\n';
  const mutants = mutantsFor(source);
  assert.deepEqual(
    mutants.map((mutant) => [mutant.line, mutant.column, mutant.original]),
    [
      [2, 13, '==='],
      [2, 19, '&&'],
    ],
  );
});

test('applying a mutant replaces exactly the matched operator', () => {
  const source = 'const a = b && c;';
  const [mutant] = mutantsFor(source);
  assert.equal(applyMutant(source, mutant), 'const a = b || c;');
});

test('a mutant describes itself by file, position and operator', () => {
  assert.equal(
    describeMutant('src/x.js', {
      line: 4,
      column: 7,
      original: '&&',
      replacement: '||',
      operator: 'and-to-or',
    }),
    'src/x.js:4:7 && -> || (and-to-or)',
  );
});

test('the operator patterns are reusable across calls', () => {
  // Each pattern carries the /g flag, so a leaked lastIndex would make the
  // second scan of the same source return fewer mutants than the first.
  const source = 'const a = b && c && d;';
  assert.equal(mutantsFor(source).length, 2);
  assert.equal(mutantsFor(source).length, 2);
});
