// The generator -> validator ordering contract, applied to the Justfile.
//
// `tests/automation-workflow-ordering.test.mjs` holds every workflow that
// regenerates a dataset to running that dataset's validator afterwards, in the
// same job. The Justfile is the other entry point the same generators are run
// from -- `just import` runs `collect:enduser-members` and
// `import:architectures` against the working tree -- and that file binds
// workflows only, because it reads `.github/workflows` and nothing else.
//
// `tests/dev-environment.test.mjs` does bind the Justfile to CI, but on a
// different axis: it asserts that the `build` recipe runs every `validate:*`
// script some workflow runs. That says nothing about ordering, and nothing at
// all about the recipes that generate data rather than gate it.
//
// The gap matters because a Justfile generator writes straight into the
// contributor's checkout with no pull request in between. A recipe that
// regenerates a dataset and stops leaves unvalidated data on disk that looks
// like the product of a successful run, and the contributor finds out at push
// time or not at all.
//
// The direction asserted is one-way, matching the Justfile contract in
// dev-environment.test.mjs: a recipe must validate what it regenerated, and is
// free to validate more than it regenerated. A stricter recipe is never the
// bug.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

const scripts =
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};

const justfile = readFileSync(join(root, 'Justfile'), 'utf8');

// The same namespaces automation-workflow-ordering.test.mjs treats as
// data-writing, matched on the package.json namespace rather than on a
// hand-kept list of names so a new collector is bound the moment it is added.
const GENERATOR_NAMESPACES = ['collect:', 'fetch:', 'import:', 'generate:'];

// Recipe bodies are the indented lines following a `name:` header line.
function parseJustRecipes(source) {
  const recipes = new Map();
  let current = null;
  for (const rawLine of source.split('\n')) {
    if (/^\s*(#.*)?$/.test(rawLine)) continue;
    const header = rawLine.match(/^([A-Za-z_][\w-]*)\s*[^:=]*:(?!=)/);
    if (header && !/^\s/.test(rawLine)) {
      current = header[1];
      recipes.set(current, []);
      continue;
    }
    if (current && /^\s/.test(rawLine))
      recipes.get(current).push(rawLine.trim());
  }
  return recipes;
}

// `npm run foo`, `npm run foo -- --bar`, `npm run -s foo`, `npm -s run foo`.
function npmRunTargets(commands) {
  const targets = [];
  const pattern = /\bnpm\s+(?:-\S+\s+)*run\s+(?:-\S+\s+)*((?!-)[\w:*.-]+)/g;
  for (const command of commands) {
    for (const match of command.matchAll(pattern)) targets.push(match[1]);
  }
  return targets;
}

function isGenerator(target) {
  return (
    target in scripts &&
    GENERATOR_NAMESPACES.some((namespace) => target.startsWith(namespace))
  );
}

// The validator that guards what a generator writes, derived from the shared
// suffix (`collect:metrics` -> `validate:metrics`). Returns undefined when the
// dataset has no validator, which is a gap in the validator set rather than an
// ordering fault and so is not this file's to report.
function validatorFor(generator) {
  const suffix = generator.slice(generator.indexOf(':') + 1);
  const validator = `validate:${suffix}`;
  return validator in scripts ? validator : undefined;
}

const justRecipes = parseJustRecipes(justfile);

function recipeTargets() {
  return [...justRecipes].map(([name, body]) => [name, npmRunTargets(body)]);
}

test('every dataset a Justfile recipe regenerates is validated in the same recipe', () => {
  const offenders = [];
  for (const [name, targets] of recipeTargets()) {
    for (let index = 0; index < targets.length; index += 1) {
      const generator = targets[index];
      if (!isGenerator(generator)) continue;
      const validator = validatorFor(generator);
      if (!validator) continue;
      const validated = targets.some(
        (target, at) => target === validator && at > index,
      );
      if (!validated) {
        offenders.push(
          `${name}: runs ${generator} without ${validator} after it`,
        );
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Justfile recipes regenerate a dataset without running its validator ' +
      `afterwards, leaving unvalidated data in the checkout:\n${offenders.join('\n')}`,
  );
});

test('a Justfile recipe does not run a validator before the generator it guards', () => {
  // Distinct from the rule above: a recipe that validates first and then
  // regenerates satisfies "runs the validator" under a set-membership check
  // while gating the previous contents of the file. Only the last generator
  // matters, because a validator placed after it is after all of them.
  const offenders = [];
  for (const [name, targets] of recipeTargets()) {
    for (const [index, generator] of targets.entries()) {
      if (!isGenerator(generator)) continue;
      const validator = validatorFor(generator);
      if (!validator) continue;
      const positions = targets.flatMap((target, at) =>
        target === validator ? [at] : [],
      );
      if (positions.length > 0 && positions.every((at) => at < index)) {
        offenders.push(`${name}: runs ${validator} before ${generator}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Justfile recipes gate the previous contents of a dataset:\n${offenders.join('\n')}`,
  );
});

test('the generator and validator detection is not vacuous', () => {
  // Pins both guards to evidence rather than to spelling. If the recipe
  // parser, the npm-target scanner or either predicate stopped matching, the
  // tests above would pass while asserting nothing at all.
  assert.ok(justRecipes.size > 0, 'no recipes parsed out of Justfile');

  const generatorsInJustfile = recipeTargets()
    .flatMap(([, targets]) => targets)
    .filter(isGenerator)
    .sort();
  assert.ok(
    generatorsInJustfile.length > 0,
    'no Justfile recipe runs a generator; if the generators moved out of the ' +
      'Justfile, delete this file rather than leaving it green and empty',
  );
  assert.ok(
    generatorsInJustfile.every((generator) => validatorFor(generator)),
    'a generator run by the Justfile has no validate:* counterpart, so the ' +
      `rules above skip it: ${generatorsInJustfile.join(', ')}`,
  );

  assert.equal(
    validatorFor('collect:enduser-members'),
    'validate:enduser-members',
  );
  assert.equal(validatorFor('import:architectures'), 'validate:architectures');
  assert.equal(isGenerator('validate:members'), false);
  assert.equal(isGenerator('collect:no-such-dataset'), false);
  assert.deepEqual(npmRunTargets(['npm run docus:start -- --host 0.0.0.0']), [
    'docus:start',
  ]);
  assert.deepEqual(
    npmRunTargets(['npm -s run build', 'npm run -s validate:members']),
    ['build', 'validate:members'],
  );
});
