// Guards .github/dependabot.yml, which no other test reads.
//
// The file is load-bearing for a guarantee that tests/ci-supply-chain.test.mjs
// already enforces from the other side: every third-party action in
// .github/workflows is pinned to a full commit SHA. A SHA pin never floats
// onto an upstream security fix, so the github-actions ecosystem entry here is
// the only mechanism that ever rewrites those pins. Delete that entry, misspell
// its directory, or set its PR limit to 0, and the pins silently freeze — every
// existing test stays green, because nothing else in the suite looks at this
// file.
//
// Dependabot validates this configuration server-side and reports a failure on
// the repository's Dependabot tab rather than on a pull request, so a malformed
// or no-op entry does not fail CI either.
//
// Assertions are limited to what is verifiable offline from the repository
// itself. In particular the `labels:` entries cannot be checked here: Dependabot
// fails a run that names a label the repository does not have, but label
// existence is only knowable from the GitHub API.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = join(repoRoot, '.github', 'dependabot.yml');

const source = readFileSync(configPath, 'utf8');
const config = parse(source);

const updates = Array.isArray(config?.updates) ? config.updates : [];

// https://docs.github.com/code-security/dependabot/working-with-dependabot/dependabot-options-reference#schedule-
const INTERVALS = new Set(['daily', 'weekly', 'monthly', 'quarterly']);
const WEEKDAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

// A directory is repo-relative and always starts with "/". Mapped to a path on
// disk so a typo cannot pass as a configured-but-inert entry.
function resolveDirectory(directory) {
  return join(repoRoot, directory.replace(/^\/+/, ''));
}

function entriesFor(ecosystem) {
  return updates.filter((entry) => entry?.['package-ecosystem'] === ecosystem);
}

// Dependabot group patterns are glob-style over dependency names, with "*" the
// only wildcard this repository uses.
function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

function declaredNpmDependencies(directory) {
  const manifest = JSON.parse(
    readFileSync(join(resolveDirectory(directory), 'package.json'), 'utf8'),
  );
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
}

test('dependabot.yml parses and declares version 2 with at least one update', () => {
  assert.ok(
    config && typeof config === 'object',
    '.github/dependabot.yml did not parse as a YAML mapping',
  );
  assert.equal(
    config.version,
    2,
    'Dependabot only accepts version 2; any other value makes the file inert',
  );
  assert.ok(updates.length > 0, 'updates must declare at least one ecosystem');
});

test('the github-actions ecosystem is configured, so SHA-pinned actions still get refreshed', () => {
  const actionEntries = entriesFor('github-actions');
  assert.equal(
    actionEntries.length,
    1,
    'exactly one github-actions entry is expected; it is the only thing that ' +
      'rewrites the commit-SHA pins enforced by tests/ci-supply-chain.test.mjs',
  );

  const [entry] = actionEntries;
  assert.equal(
    entry.directory,
    '/',
    'github-actions updates are discovered from the repository root',
  );

  // Cross-check the premise: if the workflows stopped being SHA-pinned this
  // entry would no longer be the pin-refresh mechanism, and this test's reason
  // for existing would have changed.
  const workflowDir = join(repoRoot, '.github', 'workflows');
  const workflowNames = readdirSync(workflowDir).filter((name) =>
    /\.ya?ml$/.test(name),
  );
  assert.ok(workflowNames.length > 0, 'no workflow files found to update');
  const pinned = workflowNames
    .flatMap((name) =>
      readFileSync(join(workflowDir, name), 'utf8').split(/\r?\n/),
    )
    .filter((line) => /^\s*-?\s*uses:\s*\S+@[0-9a-f]{40}\b/.test(line));
  assert.ok(
    pinned.length > 0,
    'expected at least one SHA-pinned action for this entry to keep current',
  );
});

test('the npm ecosystem is configured against the manifest it updates', () => {
  const npmEntries = entriesFor('npm');
  assert.equal(npmEntries.length, 1, 'exactly one npm entry is expected');
  assert.equal(npmEntries[0].directory, '/');
  assert.ok(
    existsSync(join(resolveDirectory('/'), 'package.json')),
    'the npm entry points at a directory with no package.json, so it updates nothing',
  );
});

test('every update entry names a directory that exists in the repository', () => {
  for (const entry of updates) {
    const { directory } = entry;
    assert.equal(
      typeof directory,
      'string',
      `${entry['package-ecosystem']}: directory must be a string`,
    );
    assert.ok(
      directory.startsWith('/'),
      `${entry['package-ecosystem']}: directory "${directory}" must be repo-relative and start with "/"`,
    );
    assert.ok(
      existsSync(resolveDirectory(directory)),
      `${entry['package-ecosystem']}: directory "${directory}" does not exist`,
    );
  }
});

test('no two update entries share an ecosystem and directory', () => {
  const seen = new Set();
  for (const entry of updates) {
    const key = `${entry['package-ecosystem']}@${entry.directory}`;
    assert.ok(!seen.has(key), `duplicate update entry for ${key}`);
    seen.add(key);
  }
});

test('every update entry schedules a supported interval', () => {
  for (const entry of updates) {
    const schedule = entry.schedule;
    assert.ok(
      schedule && typeof schedule === 'object',
      `${entry['package-ecosystem']}: schedule is required`,
    );
    assert.ok(
      INTERVALS.has(schedule.interval),
      `${entry['package-ecosystem']}: unsupported schedule interval "${schedule.interval}"`,
    );
    if (schedule.day !== undefined) {
      assert.equal(
        schedule.interval,
        'weekly',
        `${entry['package-ecosystem']}: schedule.day only applies to a weekly interval`,
      );
      assert.ok(
        WEEKDAYS.has(schedule.day),
        `${entry['package-ecosystem']}: "${schedule.day}" is not a weekday name`,
      );
    }
  }
});

test('no update entry is disabled by a zero pull-request limit', () => {
  for (const entry of updates) {
    const limit = entry['open-pull-requests-limit'];
    if (limit === undefined) continue;
    assert.equal(
      Number.isInteger(limit),
      true,
      `${entry['package-ecosystem']}: open-pull-requests-limit must be an integer`,
    );
    assert.ok(
      limit > 0,
      `${entry['package-ecosystem']}: open-pull-requests-limit 0 silently disables version updates`,
    );
  }
});

test('every update entry requests at least one label', () => {
  for (const entry of updates) {
    assert.ok(
      Array.isArray(entry.labels) && entry.labels.length > 0,
      `${entry['package-ecosystem']}: labels must list at least one label`,
    );
    const unique = new Set(entry.labels);
    assert.equal(
      unique.size,
      entry.labels.length,
      `${entry['package-ecosystem']}: labels contains a duplicate`,
    );
    for (const label of entry.labels) {
      assert.ok(
        typeof label === 'string' && label.trim() === label && label.length > 0,
        `${entry['package-ecosystem']}: "${label}" is not a usable label name`,
      );
    }
  }
});

test('every npm group pattern still matches a declared dependency', () => {
  for (const entry of entriesFor('npm')) {
    const declared = declaredNpmDependencies(entry.directory);
    for (const [groupName, group] of Object.entries(entry.groups ?? {})) {
      // Groups keyed only by dependency-type match by classification rather
      // than by name, so there is no pattern to go stale.
      if (!Array.isArray(group?.patterns)) continue;
      for (const pattern of group.patterns) {
        const matcher = patternToRegExp(pattern);
        assert.ok(
          declared.some((name) => matcher.test(name)),
          `npm group "${groupName}": pattern "${pattern}" matches no dependency in package.json`,
        );
      }
    }
  }
});

test('every group name is unique within its update entry', () => {
  for (const entry of updates) {
    const names = Object.keys(entry.groups ?? {});
    assert.equal(
      new Set(names).size,
      names.length,
      `${entry['package-ecosystem']}: duplicate group name`,
    );
  }
});
