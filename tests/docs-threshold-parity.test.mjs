// Pins the coverage thresholds the contributor docs state to the values the
// gate actually enforces.
//
// The enforced numbers live in one place: the `test:unit:coverage:check`
// script in package.json, which ci.yml runs as the "Validate repository"
// check (tests/coverage-gate-thresholds.test.mjs pins its flags to the
// measured floors). The *documented* numbers live in prose — CONTRIBUTING.md
// and AGENTS.md both spell out "99% lines / 100% source / ... regions / ...
// source regions" — and nothing tied the two together. Every ratchet of the
// gate therefore opened a window where the docs lied: #1037 (docs said no e2e
// thresholds existed while CI gated them), then #1169/#1189 (docs said 94%
// regions after #1152 enforced 95%). The same drift-by-omission class was
// closed for the audit allowlist by tests/audit-gate.test.mjs ("the allowlist
// matches the advisories SECURITY.md documents") and for the Node major by
// tests/dev-environment.test.mjs; this test closes it for the coverage
// thresholds. See #1193.
//
// The assertion is deliberately phrased against the full four-number phrase
// rather than individual numbers: a doc that drops one clause or reorders the
// phrase stops matching and fails loudly, instead of a stray "94%" elsewhere
// in the file passing a looser per-number check.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const gateCommand = manifest.scripts?.['test:unit:coverage:check'];

function enforcedThresholds(command) {
  const tokens = command.split(/\s+/);
  const flags = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('--check')) flags.set(tokens[i], tokens[i + 1]);
  }
  return {
    lines: flags.get('--check'),
    source: flags.get('--check-source'),
    regions: flags.get('--check-regions'),
    sourceRegions: flags.get('--check-source-regions'),
  };
}

// Markdown wraps the phrase across lines, so prose is compared with its
// whitespace collapsed. The pattern tolerates only whitespace variation —
// wording and clause order must match exactly, by design.
const THRESHOLD_PHRASE =
  /(\d+)% lines \/ (\d+)% source \/ (\d+)% regions \/ (\d+)% source regions/g;

// Every contributor-facing document that states the unit-coverage thresholds.
// A doc that starts stating them must be added here; a doc listed here that
// stops stating them fails the at-least-one-match assertion rather than
// passing vacuously.
const DOCS_STATING_THRESHOLDS = ['CONTRIBUTING.md', 'AGENTS.md'];

test('the coverage gate script defines all four thresholds', () => {
  assert.equal(
    typeof gateCommand,
    'string',
    'package.json must keep a test:unit:coverage:check script; the docs parity below reads its flags',
  );
  const enforced = enforcedThresholds(gateCommand);
  for (const [name, value] of Object.entries(enforced)) {
    assert.match(
      value ?? '',
      /^\d+$/,
      `test:unit:coverage:check must pass a numeric ${name} threshold for the docs to mirror`,
    );
  }
});

for (const doc of DOCS_STATING_THRESHOLDS) {
  test(`${doc} states the thresholds the coverage gate enforces`, () => {
    const enforced = enforcedThresholds(gateCommand);
    const prose = readFileSync(join(repoRoot, doc), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    const matches = [...prose.matchAll(THRESHOLD_PHRASE)];
    assert.ok(
      matches.length > 0,
      `${doc} no longer states the coverage thresholds; either restore the ` +
        `"N% lines / N% source / N% regions / N% source regions" phrase or ` +
        `remove the file from DOCS_STATING_THRESHOLDS`,
    );
    for (const [phrase, lines, source, regions, sourceRegions] of matches) {
      assert.deepEqual(
        { lines, source, regions, sourceRegions },
        enforced,
        `${doc} documents "${phrase}" but test:unit:coverage:check enforces ` +
          `${enforced.lines}% lines / ${enforced.source}% source / ` +
          `${enforced.regions}% regions / ${enforced.sourceRegions}% source ` +
          `regions; update the doc in the same commit as the ratchet`,
      );
    }
  });
}
