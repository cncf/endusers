// Values a pull request controls, pinned against the step outputs they are
// written into.
//
// `$GITHUB_OUTPUT` is a line-oriented key=value file: the runner reads it back
// after the step and turns every `key=value` line into an output other steps
// interpolate. Nothing in that format escapes a newline, so a value carrying
// one ends its own assignment and starts a second -- a step that writes an
// unvalidated string smuggles extra outputs of the attacker's choosing into
// every later step that reads them.
//
// `.github/workflows/ci.yml` resolves `@playwright/test`'s version out of
// `package-lock.json`, which a pull request controls, and both Playwright jobs
// already state the rule in a comment of their own ("an unvalidated newline
// inside it would end the version assignment and smuggle extra key=value pairs
// into the step outputs"). Both get it right today, by refusing anything
// outside the character set a version string can contain before the write.
// Nothing held them to it: the guard could be dropped from either job, or a
// third job could write a lock-file value straight through, and the suite
// stayed green.
//
// Two shapes are refused. A `${{ ... }}` expression interpolated directly into
// the output line is beyond rescue -- the runner substitutes it into the
// script's text before a shell guard can inspect it -- so it is reported
// wherever it appears. A shell variable is accepted only when the same script
// constrains it first: an earlier `case`/`if`/`test` naming that variable on a
// path that can abort the step, or an assignment that filters the value
// through `tr`/`sed`/`cut`/`awk` or the shell's own pattern removal.
//
// Scanning follows local composite actions through `walkSteps()`, so moving a
// `run:` step into `.github/actions/<name>/action.yml` does not take it out of
// scope. Like tests/ci-playwright-setup.test.mjs, the scanner is driven twice:
// over the real `.github/workflows/**` tree, which must be clean, and over
// synthetic documents that do offend, so a scanner that stopped detecting
// cannot leave the contract green.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';

import {
  loadWorkflows as readWorkflows,
  stepLabel,
  walkWorkflowSteps,
} from './helpers-workflows.mjs';

// A line appending to the step-output file, in either of the two spellings
// bash accepts for it.
const OUTPUT_WRITE = /^.*>>\s*(?:"\$GITHUB_OUTPUT"|\$GITHUB_OUTPUT)\s*$/;

// `${{ ... }}` anywhere on the line: the runner expands it into the script
// text, so no shell-level guard can have seen it.
const GITHUB_EXPRESSION = /\$\{\{[\s\S]*?\}\}/;

// `$var` / `${var}`, excluding `$GITHUB_OUTPUT` itself, which is the
// destination rather than a value.
const SHELL_VARIABLE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

function outputWriteLines(run) {
  return run.split('\n').filter((line) => OUTPUT_WRITE.test(line));
}

function referencedVariables(line) {
  const names = new Set();
  for (const [, name] of line.matchAll(SHELL_VARIABLE)) {
    if (name === 'GITHUB_OUTPUT') continue;
    names.add(name);
  }
  return [...names];
}

// Everything the script runs before the first line that writes this variable
// into the output file. A guard placed after the write protects nothing, so
// only the text above it counts.
function textBeforeWrite(run, name) {
  const lines = run.split('\n');
  const index = lines.findIndex(
    (line) =>
      OUTPUT_WRITE.test(line) && referencedVariables(line).includes(name),
  );
  return lines.slice(0, index).join('\n');
}

// A guard either rejects the value or rewrites it. Rejection is a `case`,
// `if`, or `[`/`[[` test naming the variable; rewriting is an assignment whose
// right-hand side puts the value through a filter or the shell's pattern
// removal. Either way the string reaching `$GITHUB_OUTPUT` is no longer
// whatever the lock file said.
function isConstrained(before, name) {
  const reference = `\\$\\{?${name}\\}?`;
  const rejects = [
    new RegExp(`\\bcase\\s+"?${reference}"?\\s+in\\b`),
    new RegExp(`\\bif\\s+.*${reference}`),
    new RegExp(`\\[\\[?[^\\n]*${reference}`),
  ];
  if (rejects.some((pattern) => pattern.test(before))) return true;
  // `version="$(printf %s "$raw" | tr -d '\n')"` and friends, including the
  // pure-shell `${raw//$'\n'/}` form that needs no external command.
  const filtered = new RegExp(
    `\\b${name}=[^\\n]*(?:\\|\\s*(?:tr|sed|cut|awk|head|grep)\\b|\\$\\{[A-Za-z_][A-Za-z0-9_]*(?:##|%%|//|#|%))`,
  );
  return filtered.test(before);
}

export function unguardedStepOutputWrites(workflows) {
  const offences = [];
  for (const { workflow, jobId, step, via } of walkWorkflowSteps(workflows)) {
    if (typeof step?.run !== 'string') continue;
    const label = `${workflow} (${jobId}): ${stepLabel(step, via)}`;
    for (const line of outputWriteLines(step.run)) {
      if (GITHUB_EXPRESSION.test(line)) {
        offences.push(
          `${label} interpolates a workflow expression straight into $GITHUB_OUTPUT: ${line.trim()}`,
        );
        continue;
      }
      for (const name of referencedVariables(line)) {
        if (isConstrained(textBeforeWrite(step.run, name), name)) continue;
        offences.push(
          `${label} writes $${name} to $GITHUB_OUTPUT without constraining it first`,
        );
      }
    }
  }
  return offences.sort();
}

test('every step output is constrained before it is written', () => {
  const workflows = readWorkflows();
  const writers = [...walkWorkflowSteps(workflows)].filter(
    ({ step }) =>
      typeof step?.run === 'string' && outputWriteLines(step.run).length > 0,
  );
  assert.ok(
    writers.length > 0,
    'no workflow writes to $GITHUB_OUTPUT any more; this contract has nothing left to check',
  );

  assert.deepEqual(unguardedStepOutputWrites(workflows), []);
});

// The synthetic half. Each document below is a workflow this contract must
// reject, so the scanner above cannot pass by failing to look.

function synthetic(yaml) {
  return [{ name: 'synthetic.yml', doc: parse(yaml) }];
}

test("ci.yml's own version resolution is what the contract accepts", () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve Playwright version
        id: playwright-version
        run: |
          version="$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")"
          case "$version" in
            '' | *[!0-9A-Za-z.+-]*)
              echo "::error::Refusing an implausible @playwright/test version"
              exit 1
              ;;
          esac
          echo "version=$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(workflows), []);
});

test('an unguarded lock-file value is reported', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve Playwright version
        run: |
          version="$(node -p "require('./package-lock.json').version")"
          echo "version=$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(workflows), [
    'synthetic.yml (e2e): Resolve Playwright version writes $version to $GITHUB_OUTPUT without constraining it first',
  ]);
});

test('a guard placed after the write protects nothing', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve version
        run: |
          version="$(cat version.txt)"
          echo "version=$version" >> "$GITHUB_OUTPUT"
          case "$version" in
            '' | *[!0-9.]*) exit 1 ;;
          esac
`);
  assert.deepEqual(unguardedStepOutputWrites(workflows), [
    'synthetic.yml (e2e): Resolve version writes $version to $GITHUB_OUTPUT without constraining it first',
  ]);
});

test('a workflow expression written into the output file is reported without inspecting shell guards', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - name: Record the branch
        run: echo "branch=\${{ github.head_ref }}" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(workflows), [
    'synthetic.yml (e2e): Record the branch interpolates a workflow expression straight into $GITHUB_OUTPUT: echo "branch=${{ github.head_ref }}" >> "$GITHUB_OUTPUT"',
  ]);
});

test('an if-test and a bracket test both count as guards', () => {
  const ifGuard = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve version
        run: |
          version="$(cat version.txt)"
          if ! printf '%s' "$version" | grep -qE '^[0-9.]+$'; then
            exit 1
          fi
          echo "version=$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(ifGuard), []);

  const bracketGuard = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve version
        run: |
          version="$(cat version.txt)"
          [[ "$version" =~ ^[0-9.]+$ ]] || exit 1
          echo "version=$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(bracketGuard), []);
});

test('filtering the value through a command or pattern removal counts as a guard', () => {
  const filtered = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve version
        run: |
          version="$(cat version.txt | tr -d '\\n')"
          echo "version=$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(filtered), []);

  const trimmed = synthetic(`
jobs:
  e2e:
    steps:
      - name: Resolve version
        run: |
          raw="$(cat version.txt)"
          version="\${raw%%$'\\n'*}"
          echo "version=$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(trimmed), []);
});

test('a constant output needs no guard, and the bare $GITHUB_OUTPUT spelling is still in scope', () => {
  const constant = synthetic(`
jobs:
  e2e:
    steps:
      - name: Record a literal
        run: echo "ready=true" >> $GITHUB_OUTPUT
`);
  assert.deepEqual(unguardedStepOutputWrites(constant), []);

  const unguarded = synthetic(`
jobs:
  e2e:
    steps:
      - name: Record a value
        run: |
          value="$(cat value.txt)"
          echo "value=$value" >> $GITHUB_OUTPUT
`);
  assert.deepEqual(unguardedStepOutputWrites(unguarded), [
    'synthetic.yml (e2e): Record a value writes $value to $GITHUB_OUTPUT without constraining it first',
  ]);
});

test('a step that writes no output, and a non-run step, are out of scope', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - name: Echo a value
        run: |
          version="$(cat version.txt)"
          echo "version=$version"
`);
  assert.deepEqual(unguardedStepOutputWrites(workflows), []);
});

test('two unguarded variables on one line are reported separately', () => {
  const workflows = synthetic(`
jobs:
  e2e:
    steps:
      - name: Record a pair
        run: |
          name="$(cat name.txt)"
          version="$(cat version.txt)"
          echo "key=$name-$version" >> "$GITHUB_OUTPUT"
`);
  assert.deepEqual(unguardedStepOutputWrites(workflows), [
    'synthetic.yml (e2e): Record a pair writes $name to $GITHUB_OUTPUT without constraining it first',
    'synthetic.yml (e2e): Record a pair writes $version to $GITHUB_OUTPUT without constraining it first',
  ]);
});
