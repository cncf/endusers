// Guards .markdown-link-check.json, the configuration `npm run check:links`
// hands to markdown-link-check. Nothing else in the suite reads that file.
//
// It fails silently by construction. markdown-link-check does not pass the
// parsed config object through to the checker: its CLI copies a fixed list of
// keys onto `opts` and drops everything else, with no warning and no non-zero
// exit. A key that is misspelled, renamed by a dependency bump, or invented
// outright is therefore indistinguishable from one that works — the run stays
// green and the setting simply does not apply.
//
// That is how `fallbackHttpStatus` survived in this file: it sat next to
// `retryOn429`/`retryCount` reading as the clause that tolerates a rate-limited
// host, while liveness was decided solely by `aliveStatusCodes`. The cost of
// the mistake is not a crash, it is a config file that documents a guarantee
// the tool is not providing.
//
// The accepted key set below is derived from the installed CLI source rather
// than hard-coded, so bumping the markdown-link-check devDependency past a
// rename or removal fails here instead of quietly disabling a setting.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const read = (relativePath) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

const CONFIG_PATH = '.markdown-link-check.json';
const CLI_PATH = 'node_modules/markdown-link-check/markdown-link-check';

// Every config property the CLI assigns onto its options object. That is the
// shape every honoured setting is read through (`opts.x = config.x`), so the
// resulting set is exactly the keys the tool consults; anything else in the
// JSON is inert.
//
// Method calls are excluded: the CLI also does `config.trim()` on the
// `--config` argument itself, which is a string, not a setting.
export function acceptedKeys(cliSource) {
  const keys = new Set();
  for (const match of cliSource.matchAll(/=\s*config\.([A-Za-z_$][\w$]*)/g)) {
    const next = cliSource
      .slice(match.index + match[0].length)
      .match(/^\s*(.)/);
    if (next?.[1] === '(') continue;
    keys.add(match[1]);
  }
  return keys;
}

const accepted = acceptedKeys(read(CLI_PATH));
const config = JSON.parse(read(CONFIG_PATH));

test('the installed CLI exposes a recognisable config key set', () => {
  // Fails if markdown-link-check stops reading keys off a `config` object —
  // at which point the derivation above is measuring nothing and every other
  // assertion in this file is vacuously true.
  assert.ok(
    accepted.size >= 5,
    `expected to recover the config keys markdown-link-check reads from ${CLI_PATH}, found ${accepted.size}: ${[...accepted].join(', ') || '(none)'}. If the CLI was restructured, update acceptedKeys() to match.`,
  );
  for (const key of ['ignorePatterns', 'aliveStatusCodes', 'retryOn429']) {
    assert.ok(
      accepted.has(key),
      `${CLI_PATH} no longer reads config.${key}; the option was renamed or removed upstream`,
    );
  }
});

test('every key in .markdown-link-check.json is one the installed CLI reads', () => {
  const ignored = Object.keys(config).filter((key) => !accepted.has(key));
  assert.deepEqual(
    ignored,
    [],
    `${CONFIG_PATH} declares keys markdown-link-check never reads, so they have no effect on 'npm run check:links': ${ignored.join(', ')}. Remove them, or correct them to one of: ${[...accepted].sort().join(', ')}.`,
  );
});

test('acceptedKeys recovers assignments and ignores unrelated text', () => {
  const recovered = acceptedKeys(
    [
      'opts.timeout = config.timeout;',
      'opts.reporters = config.reporters ?? opts.reporters;',
      'input.opts.config = config.trim();',
      'if (config.notAssigned) { ... }',
      'const x = configuration.spelled;',
    ].join('\n'),
  );
  assert.ok(recovered.has('timeout'));
  assert.ok(recovered.has('reporters'));
  // A method call on the config argument is not a setting.
  assert.ok(!recovered.has('trim'));
  // A bare read that never reaches opts does not make the key honoured.
  assert.ok(!recovered.has('notAssigned'));
  // `configuration.spelled` must not be mistaken for `config.spelled`.
  assert.ok(!recovered.has('spelled'));
});

test('every ignorePatterns entry carries a pattern that compiles as a RegExp', () => {
  const patterns = config.ignorePatterns ?? [];
  assert.ok(
    Array.isArray(patterns) && patterns.length > 0,
    `${CONFIG_PATH}: ignorePatterns must be a non-empty array`,
  );
  for (const entry of patterns) {
    assert.equal(
      typeof entry?.pattern,
      'string',
      `${CONFIG_PATH}: each ignorePatterns entry needs a string 'pattern', got ${JSON.stringify(entry)}`,
    );
    // markdown-link-check builds `new RegExp(entry.pattern)` per link; an
    // uncompilable pattern throws mid-run rather than failing a link.
    assert.doesNotThrow(
      () => new RegExp(entry.pattern),
      `${CONFIG_PATH}: ignorePatterns entry ${JSON.stringify(entry.pattern)} is not a valid regular expression`,
    );
  }
});

test('aliveStatusCodes is a non-empty list of HTTP status codes', () => {
  const codes = config.aliveStatusCodes;
  assert.ok(
    Array.isArray(codes) && codes.length > 0,
    `${CONFIG_PATH}: aliveStatusCodes decides which responses count as a working link; an empty or missing list marks every link dead`,
  );
  for (const code of codes) {
    assert.ok(
      Number.isInteger(code) && code >= 100 && code <= 599,
      `${CONFIG_PATH}: aliveStatusCodes entry ${JSON.stringify(code)} is not an HTTP status code`,
    );
  }
});

test('retryOn429 is paired with a retryCount that permits a retry', () => {
  if (config.retryOn429 !== true) return;
  assert.ok(
    Number.isInteger(config.retryCount) && config.retryCount >= 1,
    `${CONFIG_PATH}: retryOn429 is on but retryCount is ${JSON.stringify(config.retryCount)}; link-check only retries while attempts < retryCount, so the retry never happens`,
  );
});

test('timeout is a duration string link-check can parse', () => {
  if (config.timeout === undefined) return;
  assert.match(
    config.timeout,
    /^\d+(?:\.\d+)?\s*(?:ms|s|m|h)$/,
    `${CONFIG_PATH}: timeout is passed to ms(); ${JSON.stringify(config.timeout)} is not a duration it parses`,
  );
});

test('the config is pinned to the repository root', () => {
  // The package script passes `--config .markdown-link-check.json` relative to
  // the repo root; a moved file would be silently ignored by the CLI.
  const { scripts } = JSON.parse(read('package.json'));
  assert.ok(
    Object.values(scripts).some((script) => script.includes(CONFIG_PATH)),
    `no package script references ${CONFIG_PATH}; if check:links stopped passing --config, the settings in this file no longer apply`,
  );
});
