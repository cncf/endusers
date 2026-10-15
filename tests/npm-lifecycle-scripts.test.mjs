// The dependency-lifecycle-script contract, asserted over the real .npmrc,
// package.json and .github/workflows/** tree.
//
// `npm ci` runs preinstall/install/postinstall/prepare from every package it
// resolves -- 1490 of them here -- as arbitrary code on the runner, before any
// validator, test or lint step gets to look at the tree. Four of the eleven
// install call sites sit in jobs holding a write-scoped GITHUB_TOKEN
// (architecture-submission, refresh-metrics, pr-queue-hygiene,
// create-milestones), so a single compromised transitive dependency gets code
// execution next to a token that pushes branches and opens pull requests.
//
// The root `.npmrc` closes that off with one line. Nothing reads it back: the
// control is a single config key, deleting the file or flipping the value is a
// one-token edit, and both leave every workflow green. These tests are what
// makes removing it an argument rather than an oversight.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);

// npm runs these from dependency packages during an install. `prepare` is in
// the list because `npm ci` runs it too, and because it is the hook most often
// added to a project's own manifest without anyone noticing it is also a
// dependency hook.
const LIFECYCLE_HOOKS = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
];

/** Last-wins parse of an npm config file: `key=value`, `#`/`;` comments. */
function readNpmConfig(source) {
  const config = new Map();
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    config.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return config;
}

function findNpmrcFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findNpmrcFiles(full, found);
    else if (entry.isFile() && entry.name === '.npmrc')
      found.push(relative(repoRoot, full));
  }
  return found;
}

const workflows = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    return { name, source, doc: parse(source) };
  });

function* installSteps() {
  for (const { name, doc } of workflows) {
    const workflowDefault = doc?.defaults?.run?.['working-directory'];
    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      const jobDefault = job?.defaults?.run?.['working-directory'];
      for (const [index, step] of (job?.steps ?? []).entries()) {
        const run = typeof step?.run === 'string' ? step.run : '';
        if (!/\bnpm\s+(ci|install|i)\b/.test(run)) continue;
        yield {
          where: `${name} ${jobId} step[${index}]`,
          run,
          workingDirectory:
            step?.['working-directory'] ?? jobDefault ?? workflowDefault ?? '.',
          env: {
            ...(doc?.env ?? {}),
            ...(job?.env ?? {}),
            ...(step?.env ?? {}),
          },
        };
      }
    }
  }
}

test('.npmrc is tracked at the repository root and is the only npm config in the tree', () => {
  const found = findNpmrcFiles(repoRoot);
  assert.deepEqual(
    found,
    ['.npmrc'],
    'the install hardening lives in the root .npmrc; a second .npmrc deeper in ' +
      'the tree silently overrides it for installs run from that directory',
  );
  assert.ok(
    statSync(join(repoRoot, '.npmrc')).isFile(),
    '.npmrc must be a regular file',
  );
});

test('the root .npmrc disables dependency lifecycle scripts', () => {
  const config = readNpmConfig(readFileSync(join(repoRoot, '.npmrc'), 'utf8'));
  assert.equal(
    config.get('ignore-scripts'),
    'true',
    'ignore-scripts=true is the control that stops `npm ci` executing ' +
      'preinstall/install/postinstall/prepare from every resolved package. ' +
      'Removing or weakening it hands arbitrary dependency code to jobs that ' +
      'hold a write-scoped GITHUB_TOKEN, and no workflow turns red when it goes.',
  );
});

test('the .npmrc records why lifecycle scripts are safe to skip', () => {
  const source = readFileSync(join(repoRoot, '.npmrc'), 'utf8');
  const comments = source
    .split('\n')
    .filter((line) => line.trim().startsWith('#'));
  assert.ok(
    comments.length > 0,
    'ignore-scripts=true is only reviewable with the reasoning beside it: a ' +
      'bare flag reads as a cargo-culted default and gets deleted by the first ' +
      'contributor whose dependency needs a build step',
  );
});

test('package.json declares no lifecycle hook scripts', () => {
  const declared = LIFECYCLE_HOOKS.filter(
    (hook) => manifest.scripts?.[hook] !== undefined,
  );
  assert.deepEqual(
    declared,
    [],
    `ignore-scripts=true suppresses this project's own hooks as well as its ` +
      `dependencies', so a hook added here never runs and the silence looks ` +
      `like success: ${declared.join(', ')}. Put the work in an explicit npm ` +
      `script the workflows call by name instead.`,
  );
});

test('every workflow npm install runs from the repository root', () => {
  const steps = [...installSteps()];
  assert.ok(steps.length > 0, 'no workflow runs an npm install');
  const offRoot = steps
    .filter(
      ({ workingDirectory }) => !['.', './', ''].includes(workingDirectory),
    )
    .map(({ where, workingDirectory }) => `${where}: ${workingDirectory}`);
  assert.deepEqual(
    offRoot,
    [],
    'npm reads the .npmrc of the directory it runs in and of that ' +
      "directory's ancestors; an install run outside the repository root " +
      `misses the root .npmrc entirely:\n${offRoot.join('\n')}`,
  );
});

test('no workflow re-enables lifecycle scripts on an npm install', () => {
  const reenabled = [];
  for (const { where, run, env } of installSteps()) {
    if (/--ignore-scripts[= ](?:false|0)\b/.test(run))
      reenabled.push(`${where}: --ignore-scripts=false on the command line`);
    if (/--foreground-scripts\b/.test(run))
      reenabled.push(`${where}: --foreground-scripts re-enables the hooks`);
    for (const [key, value] of Object.entries(env)) {
      if (!/^npm_config_ignore_scripts$/i.test(key)) continue;
      if (!/^(true|1)$/i.test(String(value)))
        reenabled.push(`${where}: ${key}=${value} overrides the .npmrc`);
    }
  }
  assert.deepEqual(
    reenabled,
    [],
    'a flag or environment variable on the install step beats the .npmrc, so ' +
      `the control can be undone without touching the file that states it:\n${reenabled.join('\n')}`,
  );
});
