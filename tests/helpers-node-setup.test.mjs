import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  findNodeSetupStep,
  isNodeSetupStep,
  loadLocalActions,
  nodeMajor,
  pinnedNodeVersion,
} from './helpers-node-setup.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SHA = 'a'.repeat(40);

const WRAPPER = parse(`
name: Fixture
description: Wraps setup-node behind an input.
inputs:
  node-version:
    default: '22'
runs:
  using: composite
  steps:
    - uses: actions/setup-node@${SHA} # v7
      with:
        node-version: \${{ inputs.node-version }}
    - run: npm ci
      shell: bash
`);

const HARDCODED = parse(`
name: Fixture
description: Pins the version on the step itself.
runs:
  using: composite
  steps:
    - uses: actions/setup-node@${SHA} # v7
      with:
        node-version: 24.1
`);

const UNRELATED = parse(`
name: Fixture
description: Installs nothing.
runs:
  using: composite
  steps:
    - run: echo hi
      shell: bash
`);

const actions = new Map([
  ['wrapper', WRAPPER],
  ['hardcoded', HARDCODED],
  ['unrelated', UNRELATED],
]);

test('recognizes a direct setup-node step and a wrapping local action', () => {
  assert.equal(isNodeSetupStep({ uses: `actions/setup-node@${SHA}` }), true);
  assert.equal(
    isNodeSetupStep({ uses: './.github/actions/wrapper' }, actions),
    true,
  );
  assert.equal(
    isNodeSetupStep({ uses: './.github/actions/unrelated' }, actions),
    false,
  );
  assert.equal(
    isNodeSetupStep({ uses: './.github/actions/missing' }, actions),
    false,
  );
  assert.equal(isNodeSetupStep({ run: 'npm test' }), false);
  assert.equal(isNodeSetupStep(undefined), false);
});

test('findNodeSetupStep returns the first installing step in a job', () => {
  const steps = [
    { uses: `actions/checkout@${SHA}` },
    { uses: './.github/actions/wrapper' },
    { uses: `actions/setup-node@${SHA}` },
  ];
  assert.equal(findNodeSetupStep(steps, actions), steps[1]);
  assert.equal(findNodeSetupStep([{ run: 'npm ci' }]), undefined);
  assert.equal(findNodeSetupStep(undefined), undefined);
});

test('a direct setup-node step resolves literals and env references', () => {
  const direct = (version) => ({
    uses: `actions/setup-node@${SHA}`,
    with: version === undefined ? {} : { 'node-version': version },
  });
  assert.equal(pinnedNodeVersion(direct(22), {}), '22');
  assert.equal(pinnedNodeVersion(direct('22.12.0'), {}), '22.12.0');
  assert.equal(
    pinnedNodeVersion(direct('${{ env.NODE_VERSION }}'), {
      env: { NODE_VERSION: 22 },
    }),
    '22',
  );
  assert.equal(pinnedNodeVersion(direct('${{ env.NODE_VERSION }}'), {}), null);
  assert.equal(pinnedNodeVersion(direct(undefined), {}), null);
  assert.equal(pinnedNodeVersion({ uses: `actions/setup-node@${SHA}` }), null);
});

test('a local action resolves through its input default unless the caller overrides it', () => {
  const call = (withBlock) => ({
    uses: './.github/actions/wrapper',
    ...(withBlock ? { with: withBlock } : {}),
  });
  assert.equal(pinnedNodeVersion(call(), {}, actions), '22');
  assert.equal(
    pinnedNodeVersion(call({ 'node-version': 24 }), {}, actions),
    '24',
  );
  assert.equal(
    pinnedNodeVersion(
      call({ 'node-version': '${{ env.NODE_VERSION }}' }),
      { env: { NODE_VERSION: '20' } },
      actions,
    ),
    '20',
  );
  assert.equal(
    pinnedNodeVersion(
      call({ 'node-version': '${{ env.NODE_VERSION }}' }),
      {},
      actions,
    ),
    null,
  );
});

test('a local action that hard-codes the version on its step is read as that literal', () => {
  assert.equal(
    pinnedNodeVersion({ uses: './.github/actions/hardcoded' }, {}, actions),
    '24.1',
  );
});

test('a local action that pins nothing resolvable is null', () => {
  const noInputDefault = parse(`
runs:
  using: composite
  steps:
    - uses: actions/setup-node@${SHA}
      with:
        node-version: \${{ inputs.node-version }}
`);
  const noVersionAtAll = parse(`
runs:
  using: composite
  steps:
    - uses: actions/setup-node@${SHA}
`);
  const local = new Map([
    ['no-default', noInputDefault],
    ['no-version', noVersionAtAll],
  ]);
  assert.equal(
    pinnedNodeVersion({ uses: './.github/actions/no-default' }, {}, local),
    null,
  );
  assert.equal(
    pinnedNodeVersion({ uses: './.github/actions/no-version' }, {}, local),
    null,
  );
  assert.equal(
    pinnedNodeVersion({ uses: './.github/actions/unrelated' }, {}, actions),
    null,
  );
  assert.equal(
    pinnedNodeVersion({ uses: './.github/actions/missing' }, {}, actions),
    null,
  );
  assert.equal(pinnedNodeVersion({ run: 'npm ci' }, {}, actions), null);
});

test('nodeMajor keeps the major and passes null through', () => {
  assert.equal(nodeMajor('22.12.0'), '22');
  assert.equal(nodeMajor(24), '24');
  assert.equal(nodeMajor(null), null);
});

test('loadLocalActions reads every action directory and tolerates gaps', () => {
  const root = mkdtempSync(join(tmpdir(), 'endusers-local-actions-'));
  try {
    assert.deepEqual([...loadLocalActions(root).keys()], []);
    const dir = join(root, '.github/actions');
    mkdirSync(join(dir, 'one'), { recursive: true });
    mkdirSync(join(dir, 'empty'), { recursive: true });
    writeFileSync(join(dir, 'one/action.yml'), 'name: One\n');
    writeFileSync(join(dir, 'README.md'), 'not an action\n');
    const loaded = loadLocalActions(root);
    assert.deepEqual([...loaded.keys()], ['one']);
    assert.equal(loaded.get('one').name, 'One');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository action pins the Node major the workflows build on', () => {
  const local = loadLocalActions(repoRoot);
  assert.ok(
    local.has('setup-node-deps'),
    '.github/actions/setup-node-deps is missing',
  );
  assert.equal(
    pinnedNodeVersion({ uses: './.github/actions/setup-node-deps' }, {}, local),
    '22',
  );
});
