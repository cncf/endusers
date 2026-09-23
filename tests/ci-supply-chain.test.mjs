import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflowDir = new URL('../.github/workflows/', import.meta.url).pathname;

const workflows = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    return { name, source, doc: parse(source) };
  });

// `on` is parsed as the boolean true by YAML 1.1 compatibility rules, so the
// trigger block is read back through both keys.
function triggers(doc) {
  const on = doc.on ?? doc[true];
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

function jobs(doc) {
  return Object.entries(doc.jobs ?? {});
}

function steps(doc) {
  return jobs(doc).flatMap(([jobName, job]) =>
    (job?.steps ?? []).map((step, index) => ({
      jobName,
      index,
      step,
    })),
  );
}

const SHA_PINNED = /^[^@]+@[0-9a-f]{40}$/;

test('every workflow parses and declares at least one job', () => {
  assert.ok(workflows.length > 0, 'no workflow files found');
  for (const { name, doc } of workflows) {
    assert.ok(doc && typeof doc === 'object', `${name}: did not parse`);
    assert.ok(jobs(doc).length > 0, `${name}: declares no jobs`);
  }
});

test('every third-party action is pinned to a full commit SHA', () => {
  const unpinned = [];
  for (const { name, doc } of workflows) {
    for (const { jobName, step } of steps(doc)) {
      const uses = step?.uses;
      if (!uses) continue;
      // Local composite actions and reusable workflows in this repository are
      // resolved from the checked-out tree, so they carry no external ref.
      if (uses.startsWith('./')) continue;
      if (uses.startsWith('docker://')) continue;
      if (!SHA_PINNED.test(uses)) {
        unpinned.push(`${name} (${jobName}): ${uses}`);
      }
    }
  }
  assert.deepEqual(
    unpinned,
    [],
    `actions must be pinned to a 40-character commit SHA, not a tag or branch:\n${unpinned.join('\n')}`,
  );
});

test('every pinned action records the human-readable version in a comment', () => {
  const missing = [];
  for (const { name, source } of workflows) {
    for (const line of source.split('\n')) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
      if (!match) continue;
      const uses = match[1];
      if (uses.startsWith('./') || uses.startsWith('docker://')) continue;
      if (!/#\s*\S/.test(line)) {
        missing.push(`${name}: ${uses}`);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `each SHA-pinned action needs a trailing '# vX' comment so the pin stays reviewable:\n${missing.join('\n')}`,
  );
});

test('every workflow constrains GITHUB_TOKEN permissions', () => {
  const unconstrained = [];
  for (const { name, doc } of workflows) {
    if (doc.permissions) continue;
    for (const [jobName, job] of jobs(doc)) {
      if (!job?.permissions) unconstrained.push(`${name}: job ${jobName}`);
    }
  }
  assert.deepEqual(
    unconstrained,
    [],
    `declare 'permissions:' at workflow or job level so GITHUB_TOKEN is not left at the repository default:\n${unconstrained.join('\n')}`,
  );
});

test('no workflow grants blanket write-all permissions', () => {
  for (const { name, doc } of workflows) {
    const scopes = [
      doc.permissions,
      ...jobs(doc).map(([, job]) => job?.permissions),
    ];
    for (const scope of scopes) {
      assert.notEqual(
        scope,
        'write-all',
        `${name}: 'permissions: write-all' defeats least privilege`,
      );
    }
  }
});

test('no workflow uses the pull_request_target trigger', () => {
  for (const { name, doc } of workflows) {
    assert.ok(
      !triggers(doc).includes('pull_request_target'),
      `${name}: pull_request_target runs with a writable token in the base repository context`,
    );
  }
});

test('every Node setup step pins the same Node major version', () => {
  const versions = new Set();
  for (const { name, doc } of workflows) {
    for (const { jobName, step } of steps(doc)) {
      if (!step?.uses?.startsWith('actions/setup-node@')) continue;
      const declared = step.with?.['node-version'];
      assert.ok(
        declared !== undefined,
        `${name} (${jobName}): setup-node must declare node-version rather than inherit a default`,
      );
      const raw = String(declared);
      const fromEnv = raw.match(
        /\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/,
      );
      if (fromEnv) {
        const resolved = doc.env?.[fromEnv[1]];
        assert.ok(
          resolved !== undefined,
          `${name} (${jobName}): node-version references env.${fromEnv[1]}, which the workflow does not define`,
        );
        versions.add(String(resolved).split('.')[0]);
      } else {
        versions.add(raw.split('.')[0]);
      }
    }
  }
  assert.ok(versions.size > 0, 'no setup-node step found in any workflow');
  assert.equal(
    versions.size,
    1,
    `workflows must build on one Node major version, found: ${[...versions].sort().join(', ')}`,
  );
});
