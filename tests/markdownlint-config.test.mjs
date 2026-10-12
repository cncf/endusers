// Guards .markdownlint.yaml, which no other test reads.
//
// .github/workflows/ci.yml runs `npm run check:markdown` as a gating step, and
// that resolves through package.json to
// `markdownlint -c .markdownlint.yaml <file>`. Every markdown rule this
// repository enforces therefore comes out of this one file.
//
// The failure mode worth guarding is that weakening it is silent. markdownlint
// treats a configuration that disables everything as a successful run, not as
// an empty configuration: with a config of `default: false` the CLI prints
// nothing and exits 0 on a document that otherwise raises MD019, MD025, MD032
// and MD004. Flipping the single `default` key would leave the Markdown lint
// step green while linting nothing, and no other test in the suite looks at
// this file.
//
// The disable list has the same property in smaller doses. Three rules are
// switched off deliberately and each carries a written rationale; a fourth
// `MDxxx: false` added later is indistinguishable from those three to a reader
// and to CI. Pinning the exact set forces a new disable to be added here too,
// which is the review step that is otherwise missing.
//
// Deliberately not asserted: that `-c .markdownlint.yaml` is required to load
// this config. markdownlint-cli auto-discovers `.markdownlint.yaml` from the
// working directory, so dropping the flag changes nothing. The flag is checked
// below only as a consistency check on the script wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = join(repoRoot, '.markdownlint.yaml');

const source = readFileSync(configPath, 'utf8');
const config = parse(source);

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

// The rules this repository switches off on purpose. Each is documented in
// .markdownlint.yaml. Adding to this set is a deliberate act: it has to be
// done here as well as in the config.
const DISABLED_RULES = new Set(['MD013', 'MD025', 'MD033']);

const RULE_KEY = /^MD\d{3}$/;

function disabledRules() {
  return Object.entries(config)
    .filter(([key, value]) => RULE_KEY.test(key) && value === false)
    .map(([key]) => key);
}

test('.markdownlint.yaml parses into a non-empty rule configuration', () => {
  assert.equal(
    typeof config,
    'object',
    '.markdownlint.yaml did not parse into an object',
  );
  assert.ok(config !== null, '.markdownlint.yaml parsed as null');
  assert.ok(
    !Array.isArray(config),
    '.markdownlint.yaml parsed as an array, not a mapping',
  );
  assert.ok(
    Object.keys(config).length > 0,
    '.markdownlint.yaml is an empty mapping, so it configures nothing',
  );
});

test('the default rule set stays enabled', () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(config, 'default'),
    '.markdownlint.yaml no longer sets `default`; without it the intent of the ' +
      'disable list below is no longer stated in the file',
  );
  assert.equal(
    config.default,
    true,
    '`default` must be true. markdownlint exits 0 and reports nothing when the ' +
      'default rule set is off, so any other value leaves the gating ' +
      '`npm run check:markdown` step green while linting nothing',
  );
});

test('only the documented rules are disabled', () => {
  const disabled = disabledRules().sort();
  assert.deepEqual(
    disabled,
    [...DISABLED_RULES].sort(),
    'the set of rules disabled in .markdownlint.yaml changed. Every disable ' +
      'narrows what the gating markdown check enforces, so update ' +
      'DISABLED_RULES here in the same change and say why in the config',
  );
});

test('every rule key carries a boolean the config can act on', () => {
  const malformed = Object.entries(config)
    .filter(([key]) => RULE_KEY.test(key))
    .filter(([, value]) => typeof value !== 'boolean' && value !== null)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  assert.deepEqual(
    malformed,
    [],
    'rule entries in .markdownlint.yaml must be booleans; an object or string ' +
      'here is rule options, which this test does not model',
  );
});

test('each disabled rule is justified in the file itself', () => {
  const lines = source.split('\n');
  const unexplained = [];

  for (const rule of disabledRules()) {
    const index = lines.findIndex((line) => line.startsWith(`${rule}:`));
    assert.notEqual(
      index,
      -1,
      `${rule} is disabled but no top-level \`${rule}:\` line was found`,
    );

    // Walk back over the contiguous comment block immediately above the rule,
    // skipping the blank line that separates entries.
    let cursor = index - 1;
    if (cursor >= 0 && lines[cursor].trim() === '') cursor -= 1;
    let rationale = 0;
    while (cursor >= 0 && lines[cursor].trimStart().startsWith('#')) {
      rationale += 1;
      cursor -= 1;
    }
    if (rationale === 0) unexplained.push(rule);
  }

  assert.deepEqual(
    unexplained,
    [],
    'these rules are disabled with no comment above them explaining why. A ' +
      'bare `MDxxx: false` is indistinguishable from an accidental one',
  );
});

test('check:markdown still lints through .markdownlint.yaml', () => {
  // Resolve the `npm run <script>` chain starting at check:markdown so this
  // keeps holding if the indirection is renamed or re-layered.
  const seen = new Set();
  const queue = ['check:markdown'];
  const commands = [];

  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const command = pkg.scripts?.[name];
    assert.equal(
      typeof command,
      'string',
      `check:markdown resolves to undefined package.json script "${name}"`,
    );
    commands.push(command);
    for (const match of command.matchAll(
      /npm run (?:-s |--loglevel=\w+ )*([\w:*-]+)/g,
    )) {
      queue.push(match[1]);
    }
  }

  const linting = commands.filter((command) =>
    command.includes('markdownlint'),
  );
  assert.ok(
    linting.length > 0,
    'no script reachable from check:markdown invokes markdownlint',
  );
  for (const command of linting) {
    assert.match(
      command,
      /-c \.markdownlint\.yaml/,
      'a markdownlint invocation reachable from check:markdown no longer names ' +
        '.markdownlint.yaml, so it may not be linting with the config this ' +
        'test guards',
    );
  }
});
