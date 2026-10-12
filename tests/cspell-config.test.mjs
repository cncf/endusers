// Guards the contents of .cspell.yml, which no other test reads.
//
// tests/workflow-scripts.test.mjs already proves that the `check:spelling`
// script points at a path that exists. Nothing reads what is inside it, so the
// allowlist that decides which unknown words `npm run check:spelling` tolerates
// is unguarded: it can accumulate entries that can never match, lose the
// dictionaries that keep ordinary English out of the list, or stop ignoring the
// generated files it was written to skip, and the suite stays green either way.
//
// The redundancy guard below is the reason this file exists. cspell matches
// `words` case-insensitively unless `caseSensitive: true` is set, and this
// config does not set it, so an entry differing from another only by case can
// never be the entry that allows a word. Fifteen such entries had accumulated
// here. They read as deliberate ("we allow both spellings") while doing
// nothing, which is the failure mode an allowlist can least afford.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = join(repoRoot, '.cspell.yml');

const config = parse(readFileSync(configPath, 'utf8'));

const { words, dictionaries, ignorePaths } = config;

// Returns the entries that collide with an earlier entry under `key`, paired
// with the entry they collide with, so a failure names both sides.
function collisions(entries, key) {
  const firstSeen = new Map();
  const found = [];
  for (const entry of entries) {
    const identity = key(entry);
    if (firstSeen.has(identity)) {
      found.push(`${entry} (already allowed by ${firstSeen.get(identity)})`);
      continue;
    }
    firstSeen.set(identity, entry);
  }
  return found;
}

test('the config declares the schema version and language cspell needs', () => {
  // cspell reads `version` as a string; the YAML quoting in the file is what
  // keeps 0.2 from parsing as a number, which cspell rejects.
  assert.equal(config.version, '0.2');
  assert.equal(typeof config.version, 'string');
  assert.equal(config.language, 'en');

  // Every assertion below indexes into these three lists; a config that
  // renamed or dropped one of them would otherwise fail as a type error.
  assert.ok(Array.isArray(words), '.cspell.yml declares no words: list');
  assert.ok(
    Array.isArray(dictionaries),
    '.cspell.yml declares no dictionaries: list',
  );
  assert.ok(
    Array.isArray(ignorePaths),
    '.cspell.yml declares no ignorePaths: list',
  );
});

test('no word entry is made unreachable by a case variant of itself', () => {
  // Case-insensitive matching is cspell's default. If this config ever opts
  // into `caseSensitive: true`, case variants start carrying meaning and this
  // assertion has to be reconsidered rather than silently inverted.
  assert.equal(
    config.caseSensitive,
    undefined,
    '.cspell.yml now sets caseSensitive; the redundancy check below assumes the default (false)',
  );

  assert.deepEqual(
    collisions(words, (word) => word.toLowerCase()),
    [],
    'remove the redundant entry: cspell matches words case-insensitively, so the lowercase form already allows every casing',
  );
});

test('every word entry is a non-empty, untrimmed-whitespace-free string', () => {
  const malformed = words.filter(
    (word) => typeof word !== 'string' || word.trim() !== word || word === '',
  );
  assert.deepEqual(malformed, []);
  assert.ok(words.length > 0, '.cspell.yml declares no words');
});

test('the dictionaries that keep ordinary English out of words: are present', () => {
  // Without en_US every common English word has to be listed by hand, and the
  // allowlist stops being a record of project-specific vocabulary.
  assert.ok(
    dictionaries.includes('en_US'),
    'dictionaries must include en_US; otherwise ordinary English words fail the check',
  );
  assert.deepEqual(
    collisions(dictionaries, (name) => name),
    [],
  );
});

test('generated and binary files stay out of the spell check', () => {
  // package-lock.json and the imported SVGs are machine-written: checking them
  // produces failures no contributor can act on except by growing words:.
  for (const required of [
    'node_modules/**',
    'build/**',
    'package-lock.json',
    '**/*.svg',
    '**/*.json',
  ]) {
    assert.ok(
      ignorePaths.includes(required),
      `.cspell.yml must ignore ${required}`,
    );
  }
  assert.deepEqual(
    collisions(ignorePaths, (path) => path),
    [],
  );
});

test('the redundancy guard reports a collision rather than matching indiscriminately', () => {
  // Proves the assertions above fail when they should: a synthetic pair that
  // differs only by case is reported, and a genuinely distinct pair is not.
  assert.deepEqual(
    collisions(['kyverno', 'Kyverno'], (word) => word.toLowerCase()),
    ['Kyverno (already allowed by kyverno)'],
  );
  assert.deepEqual(
    collisions(['kyverno', 'kubeflow'], (word) => word.toLowerCase()),
    [],
  );
});
