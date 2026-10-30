// The `just build` section of CONTRIBUTING.md, pinned to the Justfile recipe
// it enumerates and to the PR gates it tells contributors to run instead.
//
// CONTRIBUTING.md makes two claims about `just build` that nothing reads:
//
//   1. it lists, by name, the `validate:*` scripts the Justfile `build`
//      recipe runs;
//   2. it then says that recipe is *not* the same as the "Validate
//      repository" and "Lint repository" PR gates, and names the commands a
//      contributor must run as well -- `test:unit:coverage:check`,
//      `check:format`, `check:spelling`, `check:markdown` and `check:audit`.
//
// Both are prose describing files the prose never references.
// tests/dev-environment.test.mjs pins the recipe to the workflows, but only
// through a `validate:`-prefixed filter and only against the Justfile; it
// never reads CONTRIBUTING.md. tests/contributing-e2e-setup.test.mjs pins the
// e2e setup instructions, not this section. So a validator added to the
// Justfile, or a check added to either gating job, leaves this section quietly
// describing the repository as it used to be.
//
// That is the drift-by-omission class this repository has already closed three
// times, each time after the docs had lied for a while: the coverage
// thresholds (tests/docs-threshold-parity.test.mjs), the audit allowlist
// against SECURITY.md (tests/audit-gate.test.mjs), and the Node major
// (tests/dev-environment.test.mjs). The second claim is the one with teeth --
// it is the only place the repository tells a contributor how to get a green
// PR check on the first push, and a gate missing from it is a gate they find
// out about after pushing.
//
// Claim 1 is asserted as set equality rather than one-way. The one-way rule
// the sibling tests follow -- "documenting more than CI runs is never the
// bug" -- fits a doc that states a minimum. This bullet is not a minimum: it
// is an enumeration of a recipe body, so a script named here that the recipe
// does not run is as wrong as one it runs and omits. Claim 2 stays one-way,
// matching tests/contributing-e2e-setup.test.mjs: telling a contributor to run
// more than the gate needs costs them time, not a red check.
//
// Every comparison below is a pure function of the three documents, so the
// fixtures at the bottom can prove each one actually fails on a weakened
// input. A guard nobody has seen go red is indistinguishable from one that
// always passes -- the standard tests/e2e-coverage-gate.test.mjs sets for the
// coverage ratchet, applied here.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { readWorkflow } from './helpers-workflows.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CONTRIBUTING = readFileSync(join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
const JUSTFILE = readFileSync(join(repoRoot, 'Justfile'), 'utf8');
const WORKFLOW = readWorkflow('ci.yml').source;

// The two ci.yml jobs that gate a pull request. The e2e jobs are deliberately
// out of scope: CONTRIBUTING.md documents their setup separately, and
// tests/contributing-e2e-setup.test.mjs is what pins that.
const GATING_JOBS = ['validate', 'lint'];

// `just build` ends in the Justfile's own `build` recipe; ci.yml's validate
// job ends in `build:production`. Both resolve to `docus:build`, so the
// comparison below is about checks, not about which build alias ran.
const BUILD_ALIASES = new Set(['build', 'build:production', 'build:preview']);

const npmTargets = (text) =>
  [...text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((match) => match[1]);

// Recipe bodies are the indented lines following `name:` at column 0.
function justRecipe(justfile, name) {
  const lines = justfile.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `${name}:`);
  if (start === -1) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

function gatingJobTargets(workflowText) {
  const doc = parse(workflowText);
  const targets = new Map();
  for (const name of GATING_JOBS) {
    const job = doc?.jobs?.[name];
    if (!job) return null;
    for (const step of job.steps ?? []) {
      if (typeof step.run !== 'string') continue;
      for (const target of npmTargets(step.run)) {
        if (!targets.has(target)) targets.set(target, name);
      }
    }
  }
  return targets;
}

// The bullet that enumerates the recipe, sliced from its leading "- `just
// build`" to the start of the next list item or paragraph. Scoping the search
// keeps a `validate:*` mentioned elsewhere in the file out of the comparison.
function justBuildBullet(contributing) {
  const start = contributing.indexOf('- `just build`');
  if (start === -1) return null;
  const rest = contributing.slice(start + 1);
  const end = rest.search(/\n(?:- |\n)/);
  return end === -1 ? rest : rest.slice(0, end);
}

// The paragraph that follows the recipe bullets and tells a contributor what
// `just build` does *not* cover. Scoped rather than searched file-wide on
// purpose: several of these script names also appear elsewhere in
// CONTRIBUTING.md, so a file-wide search would pass on a name that survived
// in an unrelated section after this paragraph dropped it.
function compensatingParagraph(contributing) {
  const start = contributing.indexOf('These recipes are a superset');
  if (start === -1) return null;
  const rest = contributing.slice(start);
  const end = rest.indexOf('\n\n');
  return end === -1 ? rest : rest.slice(0, end);
}

// The docs write validators bare (`validate:metrics`) and commands as
// invocations (`npm run check:format`). Both are the script being named.
const namesTarget = (text, target) =>
  new RegExp(
    `\`(?:npm run )?${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``,
  ).test(text);

// Scripts the bullet lists but the recipe does not run, and vice versa.
function validatorDrift(contributing, justfile) {
  const body = justRecipe(justfile, 'build');
  const bullet = justBuildBullet(contributing);
  if (!body || !bullet) return null;
  const recipe = new Set(
    npmTargets(body).filter((target) => target.startsWith('validate:')),
  );
  const documented = new Set(
    [...bullet.matchAll(/`(?:npm run )?(validate:[A-Za-z0-9:_-]+)`/g)].map(
      (match) => match[1],
    ),
  );
  return {
    recipe,
    undocumented: [...recipe].filter((t) => !documented.has(t)),
    phantom: [...documented].filter((t) => !recipe.has(t)),
  };
}

// Gating checks `just build` does not run, split by whether the compensating
// paragraph names them.
function uncompensatedGates(contributing, justfile, workflowText) {
  const body = justRecipe(justfile, 'build');
  const paragraph = compensatingParagraph(contributing);
  const gating = gatingJobTargets(workflowText);
  if (!body || !paragraph || !gating) return null;
  const recipeTargets = new Set(npmTargets(body));
  const outstanding = [...gating].filter(
    ([target]) => !recipeTargets.has(target) && !BUILD_ALIASES.has(target),
  );
  return {
    outstanding,
    missing: outstanding
      .filter(([target]) => !namesTarget(paragraph, target))
      .map(([target, job]) => `${target} (run by the "${job}" job)`),
  };
}

test('the Justfile build recipe is readable and runs validators', () => {
  // Every assertion below is vacuous if the recipe cannot be parsed, so the
  // parse is a test rather than a silent precondition.
  const drift = validatorDrift(CONTRIBUTING, JUSTFILE);
  assert.ok(
    drift,
    'the Justfile build recipe or the `just build` bullet could not be parsed; update this test',
  );
  assert.ok(
    drift.recipe.size > 0,
    'the Justfile build recipe runs no validate:* script; update this test',
  );
});

test('CONTRIBUTING.md names exactly the validators `just build` runs', () => {
  const { undocumented, phantom } = validatorDrift(CONTRIBUTING, JUSTFILE);

  assert.deepEqual(
    undocumented,
    [],
    `the Justfile build recipe runs validators CONTRIBUTING.md does not list, so the documented recipe is shorter than the real one:\n${undocumented.join('\n')}`,
  );
  assert.deepEqual(
    phantom,
    [],
    `CONTRIBUTING.md lists validators the Justfile build recipe does not run, so it promises checks a contributor will not get:\n${phantom.join('\n')}`,
  );
});

test('CONTRIBUTING.md names every PR gate `just build` leaves out', () => {
  const result = uncompensatedGates(CONTRIBUTING, JUSTFILE, WORKFLOW);
  assert.ok(
    result,
    'the recipe, the qualifying paragraph, or a gating job could not be parsed; update this test',
  );
  assert.ok(
    result.outstanding.length > 0,
    'the Justfile build recipe now runs every gating check; this test is asserting nothing and should be rewritten or removed',
  );
  assert.deepEqual(
    result.missing,
    [],
    `the PR gates run checks "just build" does not, and the CONTRIBUTING.md paragraph that lists what to run instead never names them, so a green "just build" still fails CI:\n${result.missing.join('\n')}`,
  );
});

test('CONTRIBUTING.md still warns that `just build` is not the PR gate', () => {
  // The list above is only useful next to the claim that makes a contributor
  // read it. Without this, the names could all survive scattered through the
  // file while the section stopped saying the recipe is insufficient.
  assert.match(
    CONTRIBUTING,
    /does \*\*not\*\* imply a green PR\s+check/,
    'CONTRIBUTING.md no longer states that a green `just build` does not imply a green PR check',
  );
});

// The guards above only mean something if they fail on the drift they claim to
// catch, so each is run once more against a document edited to contain it.

test('a validator added to the recipe alone is caught', () => {
  // Anchored on the step that follows so the edit lands in `build`, not in the
  // `refresh` recipe, which also ends its validators with validate:members.
  const drifted = JUSTFILE.replace(
    '    npm run validate:members\n    npm run build\n',
    '    npm run validate:members\n    npm run validate:newly-added\n    npm run build\n',
  );
  assert.notEqual(drifted, JUSTFILE, 'the fixture edit matched nothing');
  const { undocumented, phantom } = validatorDrift(CONTRIBUTING, drifted);
  assert.deepEqual(undocumented, ['validate:newly-added']);
  assert.deepEqual(phantom, []);
});

test('a validator removed from the recipe alone is caught', () => {
  const drifted = JUSTFILE.replace('    npm run validate:awards\n', '');
  assert.notEqual(drifted, JUSTFILE, 'the fixture edit matched nothing');
  const { undocumented, phantom } = validatorDrift(CONTRIBUTING, drifted);
  assert.deepEqual(undocumented, []);
  assert.deepEqual(phantom, ['validate:awards']);
});

test('a gating check dropped from the qualifying paragraph is caught', () => {
  // The unit coverage gate is named once in that paragraph, so blanking the
  // invocation leaves `test:unit:coverage:check` running in CI and
  // undocumented here. `check:audit` would not do: the same paragraph names
  // it twice, once for this gate and once for what `npm run check` adds, so
  // dropping either mention leaves the other standing -- which is the
  // paragraph being right, not the guard being weak.
  //
  // The anchor is the bare code span rather than a phrase around it: prose
  // rewrapping moves the surrounding words across line breaks, which would
  // make this fixture match nothing and fail as "the fixture edit matched
  // nothing" on an unrelated edit. Prettier never breaks inside a code span,
  // and this paragraph holds the first of the file's two mentions, so
  // replacing the first occurrence still lands here.
  const drifted = CONTRIBUTING.replace(
    '`npm run test:unit:coverage:check`',
    'the unit coverage gate',
  );
  assert.notEqual(drifted, CONTRIBUTING, 'the fixture edit matched nothing');
  const { missing } = uncompensatedGates(drifted, JUSTFILE, WORKFLOW);
  assert.deepEqual(missing, [
    'test:unit:coverage:check (run by the "validate" job)',
  ]);
});

test('a check added to a gating job and nowhere else is caught', () => {
  const drifted = WORKFLOW.replace(
    '          npm run check:spelling\n',
    '          npm run check:spelling\n          npm run check:newly-added\n',
  );
  assert.notEqual(drifted, WORKFLOW, 'the fixture edit matched nothing');
  const { missing } = uncompensatedGates(CONTRIBUTING, JUSTFILE, drifted);
  assert.deepEqual(missing, ['check:newly-added (run by the "lint" job)']);
});

// The "update this test" paths. Each helper returns null rather than throwing
// when the shape it reads has moved, so that a restructured document fails
// with that message instead of a TypeError three frames down. Returning null
// is only useful if it happens, so the shapes are removed here one at a time.

test('a Justfile with no build recipe is reported, not crashed on', () => {
  const noRecipe = JUSTFILE.replace(/^build:\n(?:[ \t].*\n|\n)*/m, '');
  assert.ok(
    !/^build:/m.test(noRecipe),
    'the fixture edit left a build recipe behind',
  );
  assert.equal(justRecipe(noRecipe, 'build'), null);
  assert.equal(validatorDrift(CONTRIBUTING, noRecipe), null);
  assert.equal(uncompensatedGates(CONTRIBUTING, noRecipe, WORKFLOW), null);
});

test('a recipe body stops at the next recipe, not at the end of the file', () => {
  // `refresh` precedes `build` in the Justfile and runs validators of its own.
  // A parser that ran past the blank line between them would credit `just
  // build` with `validate:enduser-members` from the wrong recipe.
  const body = justRecipe(JUSTFILE, 'refresh');
  assert.ok(body, 'Justfile declares no refresh recipe; update this test');
  assert.ok(
    !body.includes('npm run build'),
    'the refresh recipe body ran on into the build recipe',
  );
});

test('a CONTRIBUTING.md without the `just build` bullet is reported', () => {
  const noBullet = CONTRIBUTING.replace('- `just build`', '- `just assemble`');
  assert.notEqual(noBullet, CONTRIBUTING, 'the fixture edit matched nothing');
  assert.equal(justBuildBullet(noBullet), null);
  assert.equal(validatorDrift(noBullet, JUSTFILE), null);
});

test('a CONTRIBUTING.md without the qualifying paragraph is reported', () => {
  const noParagraph = CONTRIBUTING.replace(
    'These recipes are a superset',
    'The recipes above are a superset',
  );
  assert.notEqual(
    noParagraph,
    CONTRIBUTING,
    'the fixture edit matched nothing',
  );
  assert.equal(compensatingParagraph(noParagraph), null);
  assert.equal(uncompensatedGates(noParagraph, JUSTFILE, WORKFLOW), null);
});

test('a ci.yml missing a gating job is reported', () => {
  const renamed = WORKFLOW.replace(/^ {2}lint:$/m, '  linting:');
  assert.notEqual(renamed, WORKFLOW, 'the fixture edit matched nothing');
  assert.equal(gatingJobTargets(renamed), null);
  assert.equal(uncompensatedGates(CONTRIBUTING, JUSTFILE, renamed), null);
});

test('a bullet or paragraph that runs to the end of the file is still read', () => {
  // Both slicers look for a following block and fall back to the remainder of
  // the document when there is none. Truncating after each anchor is what
  // reaches that arm.
  const bulletStart = CONTRIBUTING.indexOf('- `just build`');
  const truncatedBullet = CONTRIBUTING.slice(
    0,
    bulletStart + '- `just build` — run the data validators'.length,
  );
  assert.match(justBuildBullet(truncatedBullet), /run the data validators$/);

  const paragraphStart = CONTRIBUTING.indexOf('These recipes are a superset');
  const truncatedParagraph = CONTRIBUTING.slice(
    0,
    paragraphStart + 'These recipes are a superset'.length,
  );
  assert.equal(
    compensatingParagraph(truncatedParagraph),
    'These recipes are a superset',
  );
});

test('a gating job that declares no steps contributes no targets', () => {
  // `job.steps ?? []` -- a job that exists but runs nothing is not the same
  // as a job that is missing, and must not be read as one. A synthetic
  // workflow rather than an edit of ci.yml: removing every step from a real
  // job would also delete the targets the other assertions read.
  const synthetic = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - run: npm run check:audit',
    '  lint:',
    '    runs-on: ubuntu-24.04',
    '',
  ].join('\n');
  const targets = gatingJobTargets(synthetic);
  assert.deepEqual([...targets], [['check:audit', 'validate']]);
});
