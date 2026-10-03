import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

// CodeQL is the only static-analysis gate in this repository, and it is not a
// required status check: when its path filters stop matching the sources it is
// meant to scan, nothing turns red. The scan simply never starts, and the
// absence of an alert reads exactly like a clean tree. These assertions pin the
// parts of .github/workflows/codeql.yml whose silent drift would disable the
// scan rather than break it.

const root = new URL('../', import.meta.url).pathname;
const workflowPath = join(root, '.github/workflows/codeql.yml');
const workflow = parse(readFileSync(workflowPath, 'utf8'));

// `on` is parsed as the boolean true by YAML 1.1 compatibility rules, so the
// trigger block is read back through both keys.
const on = workflow.on ?? workflow[true];

// Every assertion below reads several levels into the parsed workflow. Reading
// those levels with optional chaining turns a structural change into an
// assertion about `undefined`, which names the leaf and not the level that
// actually went missing, so each level is required by name instead.
function required(value, description) {
  assert.ok(
    value !== undefined && value !== null,
    `codeql.yml declares no ${description}`,
  );
  return value;
}

// Extensions CodeQL's javascript-typescript analysis actually reads. An
// extension outside this set is not source the scanner would have looked at,
// so its absence from the path filters is not a gap.
const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
]);

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'build',
  'coverage',
  '.docusaurus',
]);

function scannedExtensions(directory = root, found = new Set()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      scannedExtensions(join(directory, entry.name), found);
      continue;
    }
    const extension = extname(entry.name);
    if (SCANNED_EXTENSIONS.has(extension)) found.add(extension);
  }
  return found;
}

function analysisSteps() {
  return Object.values(required(workflow.jobs, 'jobs')).flatMap((job) =>
    required(job.steps, 'steps for one of its jobs'),
  );
}

function codeqlStep(action) {
  const prefix = `github/codeql-action/${action}@`;
  const step = analysisSteps().find((candidate) =>
    String(candidate.uses ?? '').startsWith(prefix),
  );
  return required(step, `github/codeql-action/${action} step`);
}

function pathFilters(event) {
  const trigger = required(required(on, 'triggers')[event], `${event} trigger`);
  const paths = required(trigger.paths, `paths for its ${event} trigger`);
  assert.ok(
    Array.isArray(paths),
    `codeql.yml ${event} paths is not a list: ${JSON.stringify(paths)}`,
  );
  return paths;
}

test('required returns a present value and names the fault in the rest', () => {
  for (const present of [0, '', false, [], { a: 1 }]) {
    assert.equal(required(present, 'thing'), present);
  }
  assert.throws(() => required(undefined, 'thing'), /declares no thing/);
  assert.throws(() => required(null, 'thing'), /declares no thing/);
});

test('the analyze job may upload its results to the security tab', () => {
  const jobs = Object.entries(required(workflow.jobs, 'jobs'));
  assert.equal(jobs.length, 1, 'codeql.yml declares more than one job');
  const [jobName, job] = jobs[0];
  const permissions = required(
    job.permissions,
    `permissions for job ${jobName}`,
  );
  assert.equal(
    permissions['security-events'],
    'write',
    `codeql.yml job ${jobName} cannot upload SARIF: security-events is ${JSON.stringify(
      permissions['security-events'],
    )}`,
  );
});

test('init and analyze come from the same codeql-action release', () => {
  const init = codeqlStep('init');
  const analyze = codeqlStep('analyze');
  const initRef = init.uses.split('@')[1];
  const analyzeRef = analyze.uses.split('@')[1];
  assert.equal(
    initRef,
    analyzeRef,
    `codeql-action init (${initRef}) and analyze (${analyzeRef}) are pinned to different releases`,
  );
});

test('the analysis declares a language set and the category that names it', () => {
  const languages = required(
    required(codeqlStep('init').with, '`with` block for codeql-action/init')
      .languages,
    'languages for codeql-action/init',
  );
  assert.equal(
    typeof languages,
    'string',
    'codeql-action/init declares no languages',
  );
  assert.ok(languages.length > 0, 'codeql-action/init languages is empty');
  const category = required(
    codeqlStep('analyze').with,
    '`with` block for codeql-action/analyze',
  ).category;
  assert.equal(
    category,
    `/language:${languages}`,
    `codeql-action/analyze category ${JSON.stringify(
      category,
    )} does not name the analysed languages ${JSON.stringify(languages)}`,
  );
});

test('push and pull_request filter on the same paths', () => {
  const push = pathFilters('push');
  const pullRequest = pathFilters('pull_request');
  assert.deepEqual(
    [...pullRequest].sort(),
    [...push].sort(),
    'codeql.yml scans a different file set on push than on pull_request',
  );
});

test('every scanned source extension in the tree is matched by the path filters', () => {
  const present = scannedExtensions();
  assert.ok(
    present.size > 0,
    'found no JavaScript-family sources, so this contract is checking nothing',
  );
  const paths = new Set(pathFilters('push'));
  const unmatched = [...present]
    .filter((extension) => !paths.has(`**/*${extension}`))
    .sort();
  assert.deepEqual(
    unmatched,
    [],
    `codeql.yml path filters omit source extensions present in the tree: ${unmatched.join(
      ', ',
    )}`,
  );
});

test('a change to the scanner configuration triggers a scan', () => {
  const paths = pathFilters('push');
  assert.ok(
    paths.includes('.github/workflows/codeql.yml'),
    'codeql.yml path filters omit codeql.yml, so narrowing the scan does not run it',
  );
});

test('the dependency manifests are scanned when they change', () => {
  const paths = pathFilters('push');
  for (const manifest of ['package.json', 'package-lock.json']) {
    assert.ok(
      paths.includes(manifest),
      `codeql.yml path filters omit ${manifest}`,
    );
  }
});

test('the whole tree is scanned on a schedule, not only on matched paths', () => {
  const schedule = required(required(on, 'triggers').schedule, 'schedule');
  assert.ok(
    Array.isArray(schedule) && schedule.length > 0,
    'codeql.yml declares no schedule, so a path-filtered run is the only scan',
  );
  for (const entry of schedule) {
    const cron = required(entry.cron, 'cron for one of its schedule entries');
    assert.equal(
      typeof cron,
      'string',
      `codeql.yml schedule cron is not a string: ${JSON.stringify(cron)}`,
    );
    assert.equal(
      cron.trim().split(/\s+/).length,
      5,
      `codeql.yml schedule cron is not a five-field expression: ${cron}`,
    );
  }
});
