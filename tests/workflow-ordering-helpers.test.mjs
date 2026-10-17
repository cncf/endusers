// Drives ./helpers-workflow-ordering.mjs over workflow documents that violate
// the ordering contract, which ./automation-workflow-ordering.test.mjs can
// never do: that file asserts the violation set over .github/workflows/** is
// empty, and the repository complies, so every reporting arm in the detector
// is unreachable from there. Measured, that showed up as
// `tests/automation-workflow-ordering.test.mjs | 89.09 | 83.33 | 155-159
// 177-182 190-197 208-213 219-230` -- each uncovered range one of the
// `record(...)` calls. A rule that stopped firing, a `npm run` pattern that
// stopped matching or a `uses:` prefix that drifted would have left all four
// contracts green while checking nothing.
//
// This is the ./ci-supply-chain-helpers.test.mjs half of the same split: the
// contract asserts the clean tree, this file asserts the detector can still
// report, with the expected key and the expected detail string.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionsUsedBy,
  commitsGeneratedOutput,
  currentViolations,
  isGenerator,
  jobsOf,
  npmRunTargets,
  orderedTargets,
  publishesSite,
  runsUnitSuite,
  validatorFor,
  validatorGates,
} from './helpers-workflow-ordering.mjs';

// A stand-in for package.json's scripts map. Only membership and the namespace
// prefixes matter to the detector, so the command bodies are left empty.
const SCRIPTS = {
  'collect:metrics': '',
  'validate:metrics': '',
  'fetch:people': '',
  'validate:people': '',
  'collect:orphan': '',
  'generate:members': '',
  'validate:members': '',
  'validate:all': '',
  'check:format': '',
  'fix:format': '',
  'test:unit': '',
};

const CREATE_PR = 'peter-evans/create-pull-request@v7';

function workflow(name, steps) {
  return { name, doc: { jobs: { refresh: { steps } } } };
}

function run(command) {
  return { run: command };
}

function keys(violations) {
  return [...violations.keys()].sort();
}

test('npmRunTargets reads every spelling the workflows use', () => {
  assert.deepEqual(npmRunTargets('npm run collect:metrics'), [
    'collect:metrics',
  ]);
  assert.deepEqual(npmRunTargets('npm run -s collect:metrics'), [
    'collect:metrics',
  ]);
  assert.deepEqual(npmRunTargets('npm -s run collect:metrics'), [
    'collect:metrics',
  ]);
  assert.deepEqual(npmRunTargets('npm run build -- --flag'), ['build']);
  assert.deepEqual(
    npmRunTargets('npm run collect:metrics && npm run validate:metrics'),
    ['collect:metrics', 'validate:metrics'],
  );
  // A bare `npm ci`, and a flag where a target would be, are not targets.
  assert.deepEqual(npmRunTargets('npm ci'), []);
  assert.deepEqual(npmRunTargets('npm run -- --help'), []);
});

test('orderedTargets skips steps that are not shell steps', () => {
  assert.deepEqual(orderedTargets(undefined), []);
  assert.deepEqual(orderedTargets({ steps: [{ uses: CREATE_PR }] }), []);
  assert.deepEqual(
    orderedTargets({
      steps: [{ uses: CREATE_PR }, run('npm run test:unit'), { run: 7 }],
    }),
    ['test:unit'],
  );
});

test('jobsOf and actionsUsedBy tolerate a document without jobs or steps', () => {
  assert.deepEqual(jobsOf(undefined), []);
  assert.deepEqual(jobsOf({}), []);
  assert.deepEqual(actionsUsedBy({ jobs: { a: {} } }), []);
  assert.deepEqual(
    actionsUsedBy({
      jobs: { a: { steps: [{ uses: CREATE_PR }, { uses: 3 }] } },
    }),
    [CREATE_PR],
  );
});

test('isGenerator matches the write namespaces and nothing else', () => {
  assert.equal(isGenerator('collect:metrics', SCRIPTS), true);
  assert.equal(isGenerator('fetch:people', SCRIPTS), true);
  assert.equal(isGenerator('generate:members', SCRIPTS), true);
  // A read-only script, and a name that looks like a generator but is not in
  // package.json at all.
  assert.equal(isGenerator('validate:metrics', SCRIPTS), false);
  assert.equal(isGenerator('collect:absent', SCRIPTS), false);
});

test('runsUnitSuite recognises the stricter spellings too', () => {
  assert.equal(runsUnitSuite('test'), true);
  assert.equal(runsUnitSuite('test:unit'), true);
  assert.equal(runsUnitSuite('test:unit:coverage:check'), true);
  assert.equal(runsUnitSuite('test:e2e'), false);
});

test('validatorFor derives the validator from the shared suffix', () => {
  assert.equal(validatorFor('collect:metrics', SCRIPTS), 'validate:metrics');
  assert.equal(validatorFor('generate:members', SCRIPTS), 'validate:members');
  // A dataset with no validator is not this contract's to report.
  assert.equal(validatorFor('collect:orphan', SCRIPTS), undefined);
});

test('validatorGates lists the gates without the aggregate', () => {
  assert.deepEqual(validatorGates(SCRIPTS), [
    'validate:members',
    'validate:metrics',
    'validate:people',
  ]);
});

test('commitsGeneratedOutput and publishesSite match on the action, not the name', () => {
  assert.equal(commitsGeneratedOutput({ jobs: { a: { steps: [] } } }), false);
  assert.equal(
    commitsGeneratedOutput({ jobs: { a: { steps: [{ uses: CREATE_PR }] } } }),
    true,
  );
  assert.equal(publishesSite({ jobs: { a: { steps: [] } } }), false);
  assert.equal(
    publishesSite({
      jobs: { a: { steps: [{ uses: 'actions/deploy-pages@v4' }] } },
    }),
    true,
  );
  assert.equal(
    publishesSite({
      jobs: { a: { steps: [{ uses: 'actions/upload-pages-artifact@v3' }] } },
    }),
    true,
  );
});

test('a job with no generator reports nothing at all', () => {
  const clean = [
    workflow('read-only.yml', [
      run('npm run test:unit'),
      run('npm run check:format'),
    ]),
  ];
  assert.deepEqual(keys(currentViolations(clean, SCRIPTS)), []);
});

test('a compliant generating job reports nothing', () => {
  const compliant = [
    workflow('refresh.yml', [
      run('npm run collect:metrics'),
      run('npm run validate:metrics'),
      run('npm run fix:format'),
      run('npm run test:unit'),
      { uses: CREATE_PR },
    ]),
  ];
  assert.deepEqual(keys(currentViolations(compliant, SCRIPTS)), []);
});

test('the unit suite running before the generators is reported', () => {
  const violating = [
    workflow('refresh.yml', [
      run('npm run test:unit'),
      run('npm run collect:metrics'),
      run('npm run validate:metrics'),
    ]),
  ];
  const violations = currentViolations(violating, SCRIPTS);
  assert.deepEqual(keys(violations), [
    'refresh.yml:unit-suite-after-generators',
  ]);
  assert.equal(
    violations.get('refresh.yml:unit-suite-after-generators'),
    'runs test:unit before collect:metrics',
  );
});

test('committing generated output with no format step is reported', () => {
  const violating = [
    workflow('refresh.yml', [
      run('npm run collect:metrics'),
      run('npm run validate:metrics'),
      { uses: CREATE_PR },
    ]),
  ];
  const violations = currentViolations(violating, SCRIPTS);
  assert.deepEqual(keys(violations), ['refresh.yml:format-generated-output']);
  assert.equal(
    violations.get('refresh.yml:format-generated-output'),
    'commits generated files without running check:format or fix:format',
  );
});

test('formatting before the last generator is reported', () => {
  const violating = [
    workflow('refresh.yml', [
      run('npm run check:format'),
      run('npm run collect:metrics'),
      run('npm run validate:metrics'),
      { uses: CREATE_PR },
    ]),
  ];
  const violations = currentViolations(violating, SCRIPTS);
  assert.deepEqual(keys(violations), ['refresh.yml:format-generated-output']);
  assert.equal(
    violations.get('refresh.yml:format-generated-output'),
    'runs check:format/fix:format before collect:metrics',
  );
});

test('a regenerated dataset with no validator after it is reported', () => {
  const violating = [
    workflow('refresh.yml', [
      run('npm run validate:metrics'),
      run('npm run collect:metrics'),
    ]),
  ];
  const violations = currentViolations(violating, SCRIPTS);
  assert.deepEqual(keys(violations), [
    'refresh.yml:validate-generated-dataset',
  ]);
  assert.equal(
    violations.get('refresh.yml:validate-generated-dataset'),
    'runs collect:metrics without validate:metrics after it',
  );
});

test('a dataset with no validator at all is not reported', () => {
  const noValidator = [
    workflow('refresh.yml', [run('npm run collect:orphan')]),
  ];
  assert.deepEqual(keys(currentViolations(noValidator, SCRIPTS)), []);
});

test('a publishing workflow missing validator gates is reported', () => {
  const violating = [
    {
      name: 'deploy.yml',
      doc: {
        jobs: {
          deploy: {
            steps: [
              run('npm run validate:members'),
              { uses: 'actions/deploy-pages@v4' },
            ],
          },
        },
      },
    },
  ];
  const violations = currentViolations(violating, SCRIPTS);
  assert.deepEqual(keys(violations), ['deploy.yml:publish-runs-every-gate']);
  assert.equal(
    violations.get('deploy.yml:publish-runs-every-gate'),
    'publishes without validate:metrics, validate:people',
  );
});

test('a publishing workflow running every gate is not reported', () => {
  const compliant = [
    {
      name: 'deploy.yml',
      doc: {
        jobs: {
          gate: {
            steps: [
              run('npm run validate:members'),
              run('npm run validate:metrics'),
            ],
          },
          deploy: {
            steps: [
              run('npm run validate:people'),
              { uses: 'actions/upload-pages-artifact@v3' },
            ],
          },
        },
      },
    },
  ];
  assert.deepEqual(keys(currentViolations(compliant, SCRIPTS)), []);
});

test('violations from several workflows and rules accumulate', () => {
  // The contract filters one rule at a time out of a single map, so the map
  // has to keep entries from different files and different rules apart.
  const violating = [
    workflow('a.yml', [
      run('npm run test:unit'),
      run('npm run collect:metrics'),
    ]),
    workflow('b.yml', [run('npm run fetch:people'), { uses: CREATE_PR }]),
  ];
  assert.deepEqual(keys(currentViolations(violating, SCRIPTS)), [
    'a.yml:unit-suite-after-generators',
    'a.yml:validate-generated-dataset',
    'b.yml:format-generated-output',
    'b.yml:validate-generated-dataset',
  ]);
});
