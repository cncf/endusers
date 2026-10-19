// The detectors behind ./automation-workflow-ordering.test.mjs.
//
// Each one takes parsed workflow documents and the package.json `scripts` map
// and returns what it found, so the contract can assert an empty violation set
// over the real .github/workflows/** tree while
// ./workflow-ordering-helpers.test.mjs drives the same functions over documents
// that do violate it. Keeping them here is what makes the second half possible:
// the repository complies today, so every `record(...)` arm below is
// unreachable from the real tree, and a detector that silently stopped
// detecting would leave four contracts green while asserting nothing.
//
// Nothing here reads the repository. The caller supplies `{ name, doc }`
// records and a scripts map, which is what lets a fixture stand in for
// .github/workflows/ without writing anything to disk. The one exception is
// opensPullRequest(), which descends into local composite actions through
// walkSteps() in ./helpers-workflows.mjs; a fixture passes its own `actions`
// map to keep that read out too.

import { stepsOf, walkSteps } from './helpers-workflows.mjs';

// A script that writes data into the repository, as opposed to one that reads
// it. Matched on the package.json namespaces the repository already uses for
// that job rather than on a hand-kept list of names, so a new collector is
// bound by this contract the moment it is added.
export const GENERATOR_NAMESPACES = [
  'collect:',
  'fetch:',
  'import:',
  'generate:',
];

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
export function npmRunTargets(command) {
  const targets = [];
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const match of command.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

// Ordering only means something inside a single job: separate jobs run
// concurrently unless `needs` sequences them, so comparing step positions
// across jobs would compare things that never had an order.
export function jobsOf(doc) {
  return Object.entries(doc?.jobs ?? {});
}

// The package.json scripts a job runs, in the order its steps run them.
export function orderedTargets(job) {
  const targets = [];
  for (const step of job?.steps ?? []) {
    if (typeof step?.run !== 'string') continue;
    for (const target of npmRunTargets(step.run)) targets.push(target);
  }
  return targets;
}

export function actionsUsedBy(doc) {
  const used = [];
  for (const [, job] of jobsOf(doc)) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.uses === 'string') used.push(step.uses);
    }
  }
  return used;
}

export function isGenerator(target, scripts) {
  return (
    target in scripts &&
    GENERATOR_NAMESPACES.some((namespace) => target.startsWith(namespace))
  );
}

// `test:unit` is not the only spelling of the unit suite: `test:unit:coverage`
// runs the same files through the same runner, and `test` runs `check` plus
// `test:unit`. Recognising only the literal name would read a workflow running
// a stricter variant as skipping the suite.
export function runsUnitSuite(target) {
  return (
    target === 'test' ||
    target === 'test:unit' ||
    target.startsWith('test:unit:')
  );
}

// The validator that guards what a generator writes, derived from the shared
// suffix (`collect:metrics` -> `validate:metrics`). Returns undefined when the
// dataset has no validator, which is a gap in the validator set rather than an
// ordering fault and so is not this file's to report.
export function validatorFor(generator, scripts) {
  const suffix = generator.slice(generator.indexOf(':') + 1);
  const validator = `validate:${suffix}`;
  return validator in scripts ? validator : undefined;
}

export const CREATE_PR_ACTION = 'peter-evans/create-pull-request';

// Whether a step opens a pull request: by using the action itself, or by
// using a local composite action whose steps do.
// .github/actions/open-automation-pr wraps the action so each automation
// workflow only supplies its branch and PR text, and a detector that matched
// only the direct `uses:` would stop seeing every workflow that calls the
// wrapper. `options` is handed to walkSteps(), so `{ actions }` can supply a
// fixture's composite actions in place of the repository's.
export function opensPullRequest(step, options) {
  for (const { step: inner } of walkSteps({ steps: [step] }, options)) {
    if (
      typeof inner?.uses === 'string' &&
      inner.uses.startsWith(CREATE_PR_ACTION)
    ) {
      return true;
    }
  }
  return false;
}

// A workflow that opens a pull request out of what it just generated. Detected
// by the action it uses rather than by filename, so a renamed or newly added
// automation job is covered without editing this file.
export function commitsGeneratedOutput(doc, options) {
  return jobsOf(doc).some(([, job]) =>
    stepsOf(job).some((step) => opensPullRequest(step, options)),
  );
}

// A workflow that publishes the site through GitHub Pages. Detected by the
// deploy actions it uses, for the same reason. Since ADR 0005 the site is
// published by Netlify from netlify.toml, so no workflow matches; the detector
// stays so a reintroduced Pages deploy is held to the validator gate.
export function publishesSite(doc) {
  return actionsUsedBy(doc).some(
    (uses) =>
      uses.startsWith('actions/deploy-pages') ||
      uses.startsWith('actions/upload-pages-artifact'),
  );
}

// validate:all is the aggregate the Netlify build runs, not a gate of its own;
// tests/netlify-publish-contract.test.mjs pins that it names every gate here.
export function validatorGates(scripts) {
  return Object.keys(scripts)
    .filter((name) => name.startsWith('validate:') && name !== 'validate:all')
    .sort();
}

// Recomputes every violation in a workflow set, keyed `<workflow>:<rule>` the
// same way the contract's KNOWN_ORDERING_VIOLATIONS table is. `workflows` is a
// list of `{ name, doc }` records in the order they should be reported.
export function currentViolations(workflows, scripts) {
  const violations = new Map();
  const record = (file, rule, detail) =>
    violations.set(`${file}:${rule}`, detail);

  for (const { name, doc } of workflows) {
    for (const [, job] of jobsOf(doc)) {
      const targets = orderedTargets(job);
      const lastGenerator = lastIndexWhere(targets, (target) =>
        isGenerator(target, scripts),
      );
      if (lastGenerator === -1) continue;

      const unitSuite = targets.findIndex(runsUnitSuite);
      if (unitSuite !== -1 && unitSuite < lastGenerator) {
        record(
          name,
          'unit-suite-after-generators',
          `runs ${targets[unitSuite]} before ${targets[lastGenerator]}`,
        );
      }

      if (commitsGeneratedOutput(doc)) {
        const format = targets.findIndex(
          (target) => target === 'check:format' || target === 'fix:format',
        );
        if (format === -1 || format < lastGenerator) {
          record(
            name,
            'format-generated-output',
            format === -1
              ? 'commits generated files without running check:format or fix:format'
              : `runs check:format/fix:format before ${targets[lastGenerator]}`,
          );
        }
      }

      for (let index = 0; index < targets.length; index += 1) {
        if (!isGenerator(targets[index], scripts)) continue;
        const validator = validatorFor(targets[index], scripts);
        if (!validator) continue;
        const validated = targets.some(
          (target, at) => target === validator && at > index,
        );
        if (!validated) {
          record(
            name,
            'validate-generated-dataset',
            `runs ${targets[index]} without ${validator} after it`,
          );
        }
      }
    }
  }

  for (const { name, doc } of workflows.filter((entry) =>
    publishesSite(entry.doc),
  )) {
    const targets = new Set(
      jobsOf(doc).flatMap(([, job]) => orderedTargets(job)),
    );
    const missing = validatorGates(scripts).filter(
      (gate) => !targets.has(gate),
    );
    if (missing.length > 0) {
      record(
        name,
        'publish-runs-every-gate',
        `publishes without ${missing.join(', ')}`,
      );
    }
  }

  return violations;
}

function lastIndexWhere(targets, predicate) {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    if (predicate(targets[index])) return index;
  }
  return -1;
}
