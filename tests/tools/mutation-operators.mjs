// Line and region coverage prove that a line ran. They cannot tell whether a
// test would fail if that line changed, which is why a suite can sit at 100%
// and still leave a branch unasserted. This module is the measuring half of
// the answer: given a source file it produces the small, syntactically valid
// edits ("mutants") whose survival means nothing asserted the original.
//
// The operators are deliberately narrow. They cover the shapes the repository
// keeps finding unasserted by hand -- short-circuits, nullish fallbacks,
// equality and boundary comparisons, and boolean literals -- and nothing
// whose mutant would routinely fail to parse.
//
// Everything here is pure: text in, mutant descriptions out. The runner in
// ./mutation-run.mjs owns the filesystem and the child processes.

// Identifiers that may legally precede a regular-expression literal. After any
// other word a leading `/` is division, so `a / b` is not mistaken for the
// start of a regex that swallows the rest of the line.
const KEYWORDS_BEFORE_REGEX = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

const WORD_CHARACTER = /[A-Za-z0-9_$]/;

// A `/` that follows a value -- a closing bracket, a word that is not one of
// the keywords above, or a string delimiter -- is the division operator.
// Anything else is a position where an expression may start, so a regex
// literal is allowed there.
function regexAllowed(chars, position) {
  let index = position - 1;
  while (index >= 0 && /\s/.test(chars[index])) index -= 1;
  if (index < 0) return true;
  const character = chars[index];
  if (character === ')' || character === ']') return false;
  if (character === '"' || character === "'" || character === '`') return false;
  if (!WORD_CHARACTER.test(character)) return true;
  let start = index;
  while (start >= 0 && WORD_CHARACTER.test(chars[start])) start -= 1;
  return KEYWORDS_BEFORE_REGEX.has(chars.slice(start + 1, index + 1).join(''));
}

/**
 * Replace every character that is not executable code with a space, keeping
 * the string length and every newline intact so offsets and line numbers
 * computed against the mask address the original source.
 *
 * String bodies, template chunks, regex bodies and whole comments are blanked;
 * their delimiters are kept so `regexAllowed` can still see what preceded a
 * `/`, and so an operator can never match across one.
 *
 * @param {string} source
 * @returns {string} the masked source, the same length as `source`
 */
export function maskNonCode(source) {
  const chars = [...source];
  const length = chars.length;
  const blank = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== '\n') chars[index] = ' ';
    }
  };

  // Brace depths saved on entering a `${` substitution, so the matching `}`
  // returns to the template it interrupted rather than to the enclosing code.
  const substitutions = [];
  let depth = 0;
  let inTemplate = false;
  let index = 0;

  while (index < length) {
    const character = source[index];

    if (inTemplate) {
      if (character === '\\') {
        blank(index, Math.min(index + 2, length));
        index += 2;
      } else if (character === '`') {
        inTemplate = false;
        index += 1;
      } else if (character === '$' && source[index + 1] === '{') {
        substitutions.push(depth);
        depth = 0;
        inTemplate = false;
        index += 2;
      } else {
        blank(index, index + 1);
        index += 1;
      }
      continue;
    }

    if (character === '/' && source[index + 1] === '/') {
      let end = source.indexOf('\n', index);
      if (end < 0) end = length;
      blank(index, end);
      index = end;
      continue;
    }

    if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close < 0 ? length : close + 2;
      blank(index, end);
      index = end;
      continue;
    }

    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === character) break;
        end += 1;
      }
      blank(index + 1, Math.min(end, length));
      index = Math.min(end + 1, length);
      continue;
    }

    if (character === '`') {
      inTemplate = true;
      index += 1;
      continue;
    }

    if (character === '{') {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === '}') {
      if (depth === 0 && substitutions.length > 0) {
        depth = substitutions.pop();
        inTemplate = true;
      } else {
        depth -= 1;
      }
      index += 1;
      continue;
    }

    if (character === '/' && regexAllowed(chars, index)) {
      const end = regexLiteralEnd(source, index);
      if (end > 0) {
        blank(index + 1, end);
        index = end + 1;
        while (index < length && /[a-z]/.test(source[index])) index += 1;
        continue;
      }
    }

    index += 1;
  }

  return chars.join('');
}

// Index of the closing `/` of the regex literal opening at `start`, or -1 when
// the run hits a newline or the end of the file first -- in which case the `/`
// was division after all.
function regexLiteralEnd(source, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '\n') return -1;
    if (inCharacterClass) {
      if (character === ']') inCharacterClass = false;
    } else if (character === '[') {
      inCharacterClass = true;
    } else if (character === '/') {
      return index;
    }
    index += 1;
  }
  return -1;
}

// Comparison operators are matched only when surrounded by whitespace. That is
// the form Prettier produces for real comparisons, and it is what keeps `<`
// in `<div>`, `/>` in JSX, `=>` in an arrow and `<<` in a shift out of the
// match set, since a mutant of any of those would not parse.
export const OPERATORS = [
  { name: 'and-to-or', pattern: /&&/g, replacement: '||' },
  { name: 'or-to-and', pattern: /\|\|/g, replacement: '&&' },
  { name: 'nullish-to-or', pattern: /\?\?/g, replacement: '||' },
  { name: 'equality-to-inequality', pattern: /===/g, replacement: '!==' },
  { name: 'inequality-to-equality', pattern: /!==/g, replacement: '===' },
  { name: 'less-equal-to-less', pattern: /(?<=\s)<=(?=\s)/g, replacement: '<' },
  { name: 'less-to-less-equal', pattern: /(?<=\s)<(?=\s)/g, replacement: '<=' },
  {
    name: 'greater-equal-to-greater',
    pattern: /(?<=\s)>=(?=\s)/g,
    replacement: '>',
  },
  {
    name: 'greater-to-greater-equal',
    pattern: /(?<=\s)>(?=\s)/g,
    replacement: '>=',
  },
  { name: 'true-to-false', pattern: /\btrue\b/g, replacement: 'false' },
  { name: 'false-to-true', pattern: /\bfalse\b/g, replacement: 'true' },
];

function lineAndColumn(source, offset) {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Every mutant this module can make from `source`, in source order.
 *
 * @param {string} source
 * @returns {Array<{offset: number, original: string, replacement: string,
 *   operator: string, line: number, column: number}>}
 */
export function mutantsFor(source) {
  const masked = maskNonCode(source);
  const mutants = [];
  for (const { name, pattern, replacement } of OPERATORS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      mutants.push({
        offset: match.index,
        original: match[0],
        replacement,
        operator: name,
        ...lineAndColumn(source, match.index),
      });
    }
  }
  mutants.sort((left, right) => left.offset - right.offset);
  return mutants;
}

/**
 * The source with one mutant applied.
 *
 * @param {string} source
 * @param {{offset: number, original: string, replacement: string}} mutant
 * @returns {string}
 */
export function applyMutant(source, mutant) {
  return (
    source.slice(0, mutant.offset) +
    mutant.replacement +
    source.slice(mutant.offset + mutant.original.length)
  );
}

/**
 * A one-line description of a mutant, used in the runner's report.
 *
 * @param {string} file repository-relative path
 * @param {{line: number, column: number, original: string,
 *   replacement: string, operator: string}} mutant
 * @returns {string}
 */
export function describeMutant(file, mutant) {
  return (
    `${file}:${mutant.line}:${mutant.column} ` +
    `${mutant.original} -> ${mutant.replacement} (${mutant.operator})`
  );
}
