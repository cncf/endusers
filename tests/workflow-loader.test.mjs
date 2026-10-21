// Two things about tests/helpers-workflows.mjs. First, that it reads the
// tree the way the fifteen loaders it replaced did, and that walkSteps()
// descends into a local composite action -- a gap once missed, closed here
// for every scanner at once. Second, that it stays the only reader: a test
// module that opens .github/workflows on its own has its own scope, and its
// own blind spots.

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isWorkflowFile,
  jobEntries,
  loadLocalActions,
  loadWorkflows,
  localActionName,
  readWorkflow,
  repoRoot,
  runCommands,
  stepLabel,
  stepsOf,
  walkSteps,
  walkWorkflowSteps,
  workflowDir,
  workflowFiles,
  workflowMap,
} from './helpers-workflows.mjs';

const COMPOSITE = './.github/actions/setup-node-deps';

function fixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-workflows-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

test('isWorkflowFile accepts both workflow extensions and nothing else', () => {
  assert.equal(isWorkflowFile('ci.yml'), true);
  assert.equal(isWorkflowFile('ci.yaml'), true);
  assert.equal(isWorkflowFile('README.md'), false);
  assert.equal(isWorkflowFile('ci.yml.bak'), false);
});

test('the loaders read every workflow in a directory, sorted, with its source', () => {
  const root = fixtureTree({
    'wf/b.yml': 'name: B\njobs:\n  one:\n    steps: []\n',
    'wf/a.yaml': 'name: A\n',
    'wf/notes.md': 'not a workflow\n',
  });
  try {
    const dir = join(root, 'wf');
    assert.deepEqual(workflowFiles(dir), ['a.yaml', 'b.yml']);
    const loaded = loadWorkflows(dir);
    assert.deepEqual(
      loaded.map(({ name, path, doc }) => [
        name,
        relative(root, path),
        doc.name,
      ]),
      [
        ['a.yaml', 'wf/a.yaml', 'A'],
        ['b.yml', 'wf/b.yml', 'B'],
      ],
    );
    assert.equal(loaded[1].source, 'name: B\njobs:\n  one:\n    steps: []\n');
    assert.deepEqual([...workflowMap(dir).keys()], ['a.yaml', 'b.yml']);
    assert.equal(readWorkflow('b.yml', dir).doc.jobs.one.steps.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the defaults point at this repository', () => {
  assert.ok(workflowDir.endsWith('/.github/workflows'), workflowDir);
  const names = workflowFiles();
  assert.ok(names.includes('ci.yml'), `ci.yml missing from ${names}`);
  assert.deepEqual(
    loadWorkflows().map(({ name }) => name),
    names,
  );
  assert.equal(
    workflowMap().get('ci.yml').name,
    readWorkflow('ci.yml').doc.name,
  );
});

test('jobEntries and stepsOf read an absent block as empty', () => {
  assert.deepEqual(jobEntries(undefined), []);
  assert.deepEqual(jobEntries({ jobs: { a: {} } }), [['a', {}]]);
  assert.deepEqual(stepsOf(undefined), []);
  assert.deepEqual(stepsOf({ steps: [{ run: 'x' }] }), [{ run: 'x' }]);
});

test('localActionName reads only a reference into .github/actions', () => {
  assert.equal(localActionName(COMPOSITE), 'setup-node-deps');
  assert.equal(localActionName(`${COMPOSITE}@main`), 'setup-node-deps');
  assert.equal(localActionName('actions/checkout@abc'), null);
  assert.equal(localActionName('./other/action'), null);
  assert.equal(localActionName(undefined), null);
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

const nested = new Map([
  [
    'setup-node-deps',
    {
      runs: {
        using: 'composite',
        steps: [
          { uses: 'actions/setup-node@sha' },
          { name: 'Install dependencies', shell: 'bash', run: 'npm ci' },
          { uses: './.github/actions/inner' },
        ],
      },
    },
  ],
  [
    'inner',
    {
      runs: {
        using: 'composite',
        steps: [{ shell: 'bash', run: 'echo inner | tee log' }],
      },
    },
  ],
  ['js-action', { runs: { using: 'node20', main: 'index.js' } }],
]);

const job = {
  steps: [
    { uses: 'actions/checkout@sha' },
    { uses: COMPOSITE },
    { uses: './.github/actions/js-action' },
    { uses: './.github/actions/missing' },
    { name: 'Test', run: 'npm test' },
  ],
};

test('walkSteps descends into local composite actions and records the chain', () => {
  const seen = [...walkSteps(job, { actions: nested })].map(({ step, via }) => [
    stepLabel(step, via),
    via.length,
  ]);
  assert.deepEqual(seen, [
    ['actions/checkout@sha', 0],
    [COMPOSITE, 0],
    [`${COMPOSITE} > actions/setup-node@sha`, 1],
    [`${COMPOSITE} > Install dependencies`, 1],
    [`${COMPOSITE} > ./.github/actions/inner`, 1],
    [`${COMPOSITE} > ./.github/actions/inner > echo inner | tee log`, 2],
    ['./.github/actions/js-action', 0],
    ['./.github/actions/missing', 0],
    ['Test', 0],
  ]);
});

test('walkSteps stays on the surface when told to', () => {
  const surface = [
    ...walkSteps(job, { actions: nested, followLocalActions: false }),
  ];
  assert.equal(surface.length, job.steps.length);
  assert.ok(surface.every(({ via }) => via.length === 0));
});

test('runCommands and walkWorkflowSteps cover the composite steps too', () => {
  const doc = { jobs: { build: job, empty: {} } };
  assert.deepEqual(runCommands(doc, { actions: nested }), [
    'npm ci',
    'echo inner | tee log',
    'npm test',
  ]);
  const walked = [
    ...walkWorkflowSteps([{ name: 'w.yml', doc }], { actions: nested }),
  ];
  assert.equal(walked.length, 9);
  assert.deepEqual(
    walked.map(({ workflow, jobId }) => `${workflow}#${jobId}`),
    Array(9).fill('w.yml#build'),
  );
  assert.equal(walked[0].job, job);
});

test('stepLabel falls back from name to id to uses to the first run line', () => {
  assert.equal(stepLabel({ name: 'N', id: 'i', run: 'r' }), 'N');
  assert.equal(stepLabel({ id: 'i', run: 'r' }), 'i');
  assert.equal(stepLabel({ uses: 'a/b@c' }), 'a/b@c');
  assert.equal(stepLabel({ run: '  first\nsecond\n' }), 'first');
  assert.equal(stepLabel({}), '<unnamed step>');
  assert.equal(stepLabel(undefined), '<unnamed step>');
  assert.equal(stepLabel({ name: 'N' }, ['./a', './b']), './a > ./b > N');
});

test("the repository's composite action is inside every scanner's scope", () => {
  // Without an `actions` option walkSteps reads .github/actions itself, once.
  const ci = readWorkflow('ci.yml').doc;
  const reached = [...walkWorkflowSteps([{ name: 'ci.yml', doc: ci }])]
    .filter(({ via }) => via.length > 0)
    .map(({ jobId, step, via }) => `${jobId}: ${stepLabel(step, via)}`);
  assert.ok(
    reached.some((label) => label.endsWith('Install dependencies')),
    `no job in ci.yml reaches the composite action's install step:\n${reached.join('\n')}`,
  );
  assert.ok(
    runCommands(ci).includes('npm ci'),
    'the `npm ci` inside setup-node-deps is not among the run commands',
  );
  assert.ok(
    [...walkSteps(readWorkflow('ci.yml').doc.jobs.validate)].length >
      stepsOf(readWorkflow('ci.yml').doc.jobs.validate).length,
    'walking validate yielded no more steps than it declares',
  );
});

// --- the guard --------------------------------------------------------------

const testsDir = join(repoRoot, 'tests');
const LOADER = 'helpers-workflows.mjs';
// This file spells the forbidden shapes out as fixtures below.
const GUARD = relative(testsDir, fileURLToPath(import.meta.url));

// A filesystem call aimed at the workflow directory, however the path is
// spelled: join()'d segments, a literal, or a URL.
const DIRECT_READ =
  /\b(?:readdirSync|readFileSync|existsSync|statSync|readdir|readFile|stat)\s*\([^)]*workflows|\bjoin\s*\([^)]*['"]workflows['"]|new URL\s*\([^)]*\.github\/workflows\//;

function testModules(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'e2e' ? [] : testModules(full);
    }
    return /\.(?:mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

function directWorkflowReads(files) {
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(?:\/\/|\*)/.test(line)) return;
      if (DIRECT_READ.test(line)) {
        offenders.push(`${relative(repoRoot, file)}:${index + 1}`);
      }
    });
  }
  return offenders;
}

test('no test module reads .github/workflows except the shared loader', () => {
  const modules = testModules(testsDir).filter(
    (file) => ![LOADER, GUARD].includes(relative(testsDir, file)),
  );
  assert.ok(modules.length > 50, `only ${modules.length} test modules found`);
  assert.deepEqual(
    directWorkflowReads(modules),
    [],
    'import loadWorkflows(), readWorkflow() or walkSteps() from ' +
      `tests/${LOADER} instead; a private loader has a private scope, and ` +
      'a step moved into a composite action leaves it',
  );
});

test('the guard reads the shapes the loaders it replaced were written in', () => {
  const root = fixtureTree({
    'a.mjs': "const d = join(repoRoot, '.github', 'workflows');\n",
    'b.mjs': "readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');\n",
    'c.mjs': "const d = new URL('../.github/workflows/', import.meta.url);\n",
    'd.mjs':
      "// readdirSync(join(repoRoot, '.github', 'workflows')) in prose\n",
    'e.mjs': "const WORKFLOW_PATH = '.github/workflows/x.yml';\n",
    'f.mjs': 'existsSync(`${repoRoot}.github/workflows/ci.yml`);\n',
  });
  try {
    assert.deepEqual(
      directWorkflowReads(testModules(root)).map((hit) => hit.split('/').pop()),
      ['a.mjs:1', 'b.mjs:1', 'c.mjs:1', 'f.mjs:1'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
