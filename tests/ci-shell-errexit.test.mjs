// Guards fail-fast (`set -e`) for `run:` steps that choose their own shell.
//
// GitHub's documented defaults: "By default, fail-fast behavior is enforced
// using `set -e` for both `sh` and `bash`. When `shell: bash` is specified,
// `-o pipefail` is also applied" — and a custom template string such as
// `bash -o pipefail {0}` takes full control of the shell parameters. The
// second half is the part that bites: a template gets exactly the options it
// spells out, so asking for pipefail by writing one *silently drops errexit*.
//
// Demonstrated rather than asserted. With a two-line script whose first
// command fails:
//
//     $ printf 'false\necho REACHED\n' > t.sh
//     $ bash -o pipefail t.sh; echo "exit=$?"
//     REACHED
//     exit=0
//     $ bash -e t.sh; echo "exit=$?"
//     exit=1
//
// So the template that looks stricter than the default is weaker than it: the
// failing command is stepped over and the step reports the status of the last
// line.
//
// ci.yml has exactly one custom template today, on the unit coverage gate:
//
//     run: npm run test:unit:coverage:check | tee coverage-summary.txt
//     shell: bash -o pipefail {0}
//
// That step is correct, and this file does not ask for it to change. Its
// script is a single command, and a single command's status *is* the script's
// status whether or not errexit is set — there is no following line for
// errexit to prevent. tests/ci-pipeline-exit-codes.test.mjs is what keeps the
// `| tee` from swallowing the gate's exit code, and that is the whole of the
// risk while the script stays one command long.
//
// The hole is the next step to copy the pattern. `shell: bash -o pipefail {0}`
// reads as the house spelling for "be strict about exit codes", and the
// obvious next use is a multi-line script — build, then test, then publish.
// Written that way, a failing build is stepped over and the step goes green on
// the publish. Nothing in the suite sees it:
// tests/ci-pipeline-exit-codes.test.mjs asks only about pipefail and is
// satisfied by the very template that drops errexit;
// tests/ci-gating-jobs.test.mjs guards `continue-on-error`, which is not what
// is missing; tests/workflow-scripts.test.mjs asks only whether a command is
// run by some workflow. The two options are set by the same string and were
// guarded by half of it.
//
// The rule enforced is therefore narrow and is a statement about shell
// semantics rather than a style preference: a step whose shell is a custom
// bash/sh template that does not spell out errexit may not run more than one
// command. Steps with no `shell:`, or with the `bash`/`sh` keywords, already
// get `-e` from GitHub and are not this file's business; neither are non-POSIX
// shells such as `python` or `pwsh`, which have no errexit to lose.
//
// The allowlist below follows the PIPEFAIL_EXEMPT_STEPS convention in
// tests/ci-pipeline-exit-codes.test.mjs: a step that genuinely wants to run on
// past a failing command stays possible, but it has to be argued for here
// rather than slipped in, and the staleness guard deletes the entry once the
// step stops needing it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

// `<workflow>#<job>#<step name>` → why that script may run on past a failing
// command. Empty: the repository's one custom shell template carries a
// single-command script, which needs no exemption.
const ERREXIT_EXEMPT_STEPS = new Map([]);

// The step the custom-template pattern is copied from, named so the failure
// points at the pattern's origin rather than at a set difference.
const PATTERN_SOURCE = {
  file: 'ci.yml',
  job: 'validate',
  step: 'Run unit tests with coverage',
};

function isWorkflowFile(name) {
  return name.endsWith('.yml') || name.endsWith('.yaml');
}

const workflowFiles = readdirSync(workflowDir).filter(isWorkflowFile).sort();

const workflows = new Map(
  workflowFiles.map((file) => [
    file,
    parse(readFileSync(join(workflowDir, file), 'utf8')),
  ]),
);

// `-e` may sit alone or inside a bundled short-flag cluster (`-eo pipefail`,
// `-euo pipefail`), and `-o errexit` is the long spelling of the same option.
// `-o pipefail` must not match: `o` is a flag letter whose argument is the
// option name, so the cluster is only errexit if an `e` precedes the `o`.
const ERREXIT_FLAG =
  /(?:^|\s)-(?:[A-Za-z]*e[A-Za-z]*|[A-Za-z]*o\s+errexit)(?=\s|$)/;
const SET_ERREXIT =
  /(?:^|[\s;&|(])set\s+-(?:[A-Za-z]*e[A-Za-z]*|[A-Za-z]*o\s+errexit)(?=\s|$|;)/;

// Shell keywords GitHub documents as applying `set -e` for us. A keyword is
// not a template: the runner builds the command line and puts `-e` in it.
const ERREXIT_BY_DEFAULT = new Set(['bash', 'sh']);

// Templates this contract reasons about. A `python {0}` or `pwsh {0}` template
// has no errexit to drop, so requiring the flag there would be noise.
const POSIX_SHELL_TEMPLATE = /(?:^|[\s/])(?:bash|sh)(?=\s|$)/;

function effectiveShell(step, job, workflow) {
  return (
    step?.shell ??
    job?.defaults?.run?.shell ??
    workflow?.defaults?.run?.shell ??
    null
  );
}

// True when the step's shell is a custom template that takes control of the
// parameters. Anything containing `{0}` is a template; a bare keyword is not.
function isCustomTemplate(shell) {
  return shell !== null && shell !== undefined && String(shell).includes('{0}');
}

// True when the step's shell gives it errexit without the script asking.
// `null` is GitHub's default, which is `bash -e {0}`.
function shellAppliesErrexit(shell) {
  if (shell === null || shell === undefined) return true;
  const text = String(shell).trim();
  if (ERREXIT_BY_DEFAULT.has(text)) return true;
  if (!isCustomTemplate(text)) return false;
  return ERREXIT_FLAG.test(text);
}

// True when this contract has an opinion about the shell at all: only
// bash/sh-based custom templates, which are the ones that can silently lose
// `-e`.
function isGoverned(shell) {
  if (!isCustomTemplate(shell)) return false;
  return POSIX_SHELL_TEMPLATE.test(String(shell).trim());
}

// Removes comments and the contents of quoted spans, so a `;` inside
// `--jq 'a; b'` is not read as a command separator. Newlines are preserved
// because the command count below is line-oriented.
function stripQuotedAndComments(run) {
  let out = '';
  let quote = null;
  let i = 0;
  while (i < run.length) {
    const ch = run[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < run.length) {
        out += run[i + 1] === '\n' ? '\n' : ' ';
        i += 2;
        continue;
      }
      if (ch === '"') quote = null;
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < run.length) {
      // A line continuation joins two lines into one command, and any other
      // escaped character is a literal that cannot separate commands. Both
      // collapse to a space: unlike the line-oriented scanners elsewhere in
      // the suite, nothing here needs the newline back, because a continued
      // command is deliberately counted as one.
      out += ' ';
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ' ';
      i += 1;
      continue;
    }
    if (ch === '#' && (out === '' || /[\s;&|(]/.test(out.at(-1)))) {
      while (i < run.length && run[i] !== '\n') i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// True when the script runs at most one command, so no following command
// exists for errexit to skip. A pipeline is one command: its status is the
// script's status either way, which is the case tests/
// ci-pipeline-exit-codes.test.mjs covers. `&&` and `||` are excluded
// deliberately — `a && b` already stops at a failing `a`, but `a || b` and
// `a; b` do not, and distinguishing them is more shell semantics than a floor
// needs. Anything beyond a single pipeline asks for the flag.
function isSingleCommand(run) {
  if (typeof run !== 'string') return true;
  const bare = stripQuotedAndComments(run);
  if (/[;&]/.test(bare)) return false;
  const lines = bare.split('\n').filter((line) => line.trim() !== '');
  return lines.length <= 1;
}

function declaresErrexit(run) {
  return typeof run === 'string' && SET_ERREXIT.test(run);
}

function unguardedSteps(parsedWorkflows, allowlist) {
  const offenders = [];
  for (const [file, workflow] of parsedWorkflows) {
    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== 'string') continue;
        const key = `${file}#${jobName}#${step.name ?? step.run}`;
        if (allowlist.has(key)) continue;
        const shell = effectiveShell(step, job, workflow);
        if (!isGoverned(shell)) continue;
        if (shellAppliesErrexit(shell)) continue;
        if (declaresErrexit(step.run)) continue;
        if (isSingleCommand(step.run)) continue;
        offenders.push(key);
      }
    }
  }
  return offenders.sort();
}

function staleExemptions(parsedWorkflows, allowlist) {
  const stale = [];
  for (const key of allowlist.keys()) {
    const [file, jobName, stepName] = key.split('#');
    const workflow = parsedWorkflows.get(file);
    const job = workflow?.jobs?.[jobName];
    if (!job) {
      stale.push(`${key} (no such job)`);
      continue;
    }
    const step = (job.steps ?? []).find(
      (candidate) => (candidate.name ?? candidate.run) === stepName,
    );
    if (!step) {
      stale.push(`${key} (no such step)`);
      continue;
    }
    const shell = effectiveShell(step, job, workflow);
    if (!isGoverned(shell)) {
      stale.push(`${key} (no longer a custom POSIX shell — delete this entry)`);
      continue;
    }
    if (shellAppliesErrexit(shell) || declaresErrexit(step.run)) {
      stale.push(`${key} (now asks for errexit — delete this entry)`);
      continue;
    }
    if (isSingleCommand(step.run)) {
      stale.push(`${key} (now a single command — delete this entry)`);
    }
  }
  return stale;
}

// Each allowlist entry must carry a reason. Split out so the loop body is
// reachable from a populated fixture: ERREXIT_EXEMPT_STEPS is empty, and a
// check that only ever runs against it is a check nobody has seen work.
function reasonlessExemptions(allowlist) {
  const bad = [];
  for (const [key, reason] of allowlist) {
    if (typeof reason !== 'string' || reason.length === 0) bad.push(key);
  }
  return bad.sort();
}

// Smallest shape the scanners read: one workflow file, one job, its steps.
function fixture(jobs, extra = {}) {
  return new Map([['fixture.yml', { ...extra, jobs }]]);
}

test('every custom-shell run step in the repository keeps fail-fast', () => {
  assert.ok(
    workflowFiles.length > 0,
    'no workflows found under .github/workflows',
  );
  assert.deepEqual(
    unguardedSteps(workflows, ERREXIT_EXEMPT_STEPS),
    [...ERREXIT_EXEMPT_STEPS.keys()].sort(),
    'these run steps choose a shell template that does not spell out -e and ' +
      'run more than one command, so a failing command is stepped over and ' +
      'the step reports the status of the last one',
  );
});

test('the unit coverage gate stays a single command under its template', () => {
  const workflow = workflows.get(PATTERN_SOURCE.file);
  const job = workflow?.jobs?.[PATTERN_SOURCE.job];
  assert.ok(
    job,
    `${PATTERN_SOURCE.file} no longer defines the ${PATTERN_SOURCE.job} job`,
  );

  const step = (job.steps ?? []).find(
    (one) => one.name === PATTERN_SOURCE.step,
  );
  assert.ok(
    step,
    `"${PATTERN_SOURCE.step}" is gone from ${PATTERN_SOURCE.job}`,
  );

  // Asserted rather than skipped past: if a future change gives this step the
  // `bash` keyword or spells out `-e`, the template this file is written
  // around is gone and the guard should be deleted in that change rather than
  // sitting here reporting green over nothing.
  const shell = effectiveShell(step, job, workflow);
  assert.ok(
    isGoverned(shell) && !shellAppliesErrexit(shell),
    `"${PATTERN_SOURCE.step}" no longer runs a POSIX shell template without ` +
      '-e, so this test guards nothing — delete it along with PATTERN_SOURCE',
  );

  assert.ok(
    isSingleCommand(step.run) || declaresErrexit(step.run),
    `"${PATTERN_SOURCE.step}" runs a shell template without -e and has grown ` +
      'past one command: a failure in any line but the last would be stepped ' +
      'over and the step would report success',
  );
});

test('shellAppliesErrexit reads keywords and custom templates apart', () => {
  // GitHub's own defaults: no `shell:` is `bash -e {0}`, and both documented
  // keywords get `set -e`.
  assert.equal(shellAppliesErrexit(null), true);
  assert.equal(shellAppliesErrexit(undefined), true);
  assert.equal(shellAppliesErrexit('bash'), true);
  assert.equal(shellAppliesErrexit(' bash '), true);
  assert.equal(shellAppliesErrexit('sh'), true);

  // Templates get exactly what they spell out.
  assert.equal(shellAppliesErrexit('bash -e {0}'), true);
  assert.equal(shellAppliesErrexit('bash -eo pipefail {0}'), true);
  assert.equal(
    shellAppliesErrexit('bash --noprofile --norc -euo pipefail {0}'),
    true,
  );
  assert.equal(shellAppliesErrexit('bash -o errexit {0}'), true);

  // The template this file exists for, and its bare sibling.
  assert.equal(shellAppliesErrexit('bash -o pipefail {0}'), false);
  assert.equal(shellAppliesErrexit('bash {0}'), false);
  assert.equal(shellAppliesErrexit('sh {0}'), false);

  // A keyword the repository does not use is not silently credited.
  assert.equal(shellAppliesErrexit('python'), false);
});

test('ERREXIT_FLAG does not read -o pipefail as errexit', () => {
  // The bug this regex is most likely to have: `pipefail` contains no `e`
  // flag, but a sloppy pattern matching any `-...e...` cluster would see the
  // `e` in the option *name* and credit the template that is exactly wrong.
  assert.equal(ERREXIT_FLAG.test('bash -o pipefail {0}'), false);
  assert.equal(ERREXIT_FLAG.test('bash -eo pipefail {0}'), true);
  assert.equal(ERREXIT_FLAG.test('bash -oe pipefail {0}'), true);
});

test('isGoverned limits the rule to POSIX shell templates', () => {
  assert.equal(isGoverned('bash -o pipefail {0}'), true);
  assert.equal(isGoverned('/usr/bin/bash -o pipefail {0}'), true);
  assert.equal(isGoverned('sh {0}'), true);

  // Keywords are not templates: the runner supplies `-e` for them.
  assert.equal(isGoverned('bash'), false);
  assert.equal(isGoverned(null), false);
  assert.equal(isGoverned(undefined), false);

  // Non-POSIX shells have no errexit to lose.
  assert.equal(isGoverned('python {0}'), false);
  assert.equal(isGoverned('pwsh -command ". \'{0}\'"'), false);
  assert.equal(isGoverned('node {0}'), false);
});

test('isSingleCommand separates one command from a script', () => {
  // A pipeline is one command; its status is the script's status either way.
  assert.equal(isSingleCommand('npm run gate | tee out.txt'), true);
  assert.equal(isSingleCommand('npm test'), true);
  assert.equal(isSingleCommand('  \n  npm test  \n  '), true);
  assert.equal(isSingleCommand(undefined), true);

  // Two commands: the first can fail unnoticed.
  assert.equal(isSingleCommand('npm run build\nnpm test'), false);
  assert.equal(isSingleCommand('npm run build; npm test'), false);
  assert.equal(isSingleCommand('npm run build && npm test'), false);
  assert.equal(isSingleCommand('npm run build &'), false);

  // Comments and blank lines are not commands.
  assert.equal(isSingleCommand('# build it\nnpm test'), true);
  assert.equal(isSingleCommand('npm test # and then?'), true);

  // A separator inside a quoted argument belongs to the argument.
  assert.equal(isSingleCommand("gh api --jq '.a; .b' repos/o/r"), true);
  assert.equal(isSingleCommand('echo "a; b"'), true);

  // A line continuation joins two lines into one command.
  assert.equal(
    isSingleCommand('npm run report -- \\\n  --json out.json'),
    true,
  );

  // A real separator after a quoted one is still found.
  assert.equal(isSingleCommand("echo 'a; b'; npm test"), false);
});

test('isSingleCommand keeps scanning after a multi-line quoted span', () => {
  // Quoted spans may run across lines, and the line count below has to see
  // the lines that follow them rather than folding everything into the line
  // the quote opened on.
  assert.equal(isSingleCommand("echo '\nnot a command\n'"), true);
  assert.equal(isSingleCommand('echo "\nnot a command\n"'), true);
  assert.equal(isSingleCommand("echo 'a\nb'\nnpm test"), false);
  assert.equal(isSingleCommand('echo "a\nb"\nnpm test'), false);

  // A backslash inside a double-quoted span escapes the next character, so a
  // `\"` does not close the span and the `;` after it stays quoted.
  assert.equal(isSingleCommand('echo "a \\" b; c"'), true);
  assert.equal(isSingleCommand('echo "a \\" b"; npm test'), false);

  // An escaped newline inside double quotes continues the same command.
  assert.equal(isSingleCommand('echo "a \\\nb"'), true);
});

test('unguardedSteps reports a template that drops fail-fast', () => {
  const script = { name: 'gate', run: 'npm run build\nnpm test' };

  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: { steps: [{ ...script, shell: 'bash -o pipefail {0}' }] },
      }),
      new Map(),
    ),
    ['fixture.yml#ci#gate'],
  );

  // Each of the three ways to keep fail-fast clears it.
  assert.deepEqual(
    unguardedSteps(
      fixture({ ci: { steps: [{ ...script, shell: 'bash' }] } }),
      new Map(),
    ),
    [],
  );
  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: { steps: [{ ...script, shell: 'bash -eo pipefail {0}' }] },
      }),
      new Map(),
    ),
    [],
  );
  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: {
          steps: [
            {
              name: 'gate',
              shell: 'bash -o pipefail {0}',
              run: 'set -euo pipefail\nnpm run build\nnpm test',
            },
          ],
        },
      }),
      new Map(),
    ),
    [],
  );

  // A single command under the same template is the shape ci.yml ships.
  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: {
          steps: [
            {
              name: 'gate',
              shell: 'bash -o pipefail {0}',
              run: 'npm run gate | tee out.txt',
            },
          ],
        },
      }),
      new Map(),
    ),
    [],
  );

  // `uses:` steps have no `run` at all, and a step on the default shell is
  // not this contract's business however many commands it runs.
  assert.deepEqual(
    unguardedSteps(
      fixture({ ci: { steps: [script, { uses: 'a/b@v1' }] } }),
      new Map(),
    ),
    [],
  );

  // The allowlist suppresses exactly its own key.
  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: { steps: [{ ...script, shell: 'bash -o pipefail {0}' }] },
      }),
      new Map([['fixture.yml#ci#gate', 'because']]),
    ),
    [],
  );
});

test('unguardedSteps names an unnamed step by its command', () => {
  // `step.name` is optional; without the fallback the key would be
  // `fixture.yml#ci#undefined` and two unnamed steps would collide.
  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: {
          steps: [
            { shell: 'bash -o pipefail {0}', run: 'npm run build\nnpm test' },
          ],
        },
      }),
      new Map(),
    ),
    ['fixture.yml#ci#npm run build\nnpm test'],
  );
});

test('unguardedSteps tolerates a workflow with no jobs or steps', () => {
  // A reusable-workflow stub or a job that is only `uses:` has neither, and
  // the scanner reads every file in the directory rather than a chosen set.
  assert.deepEqual(unguardedSteps(fixture({}), new Map()), []);
  assert.deepEqual(unguardedSteps(fixture({ ci: {} }), new Map()), []);
  assert.deepEqual(
    unguardedSteps(new Map([['fixture.yml', null]]), new Map()),
    [],
  );
});

test('unguardedSteps honours job- and workflow-level shell defaults', () => {
  const script = { name: 'gate', run: 'npm run build\nnpm test' };

  assert.deepEqual(
    unguardedSteps(
      fixture({
        ci: {
          defaults: { run: { shell: 'bash -o pipefail {0}' } },
          steps: [script],
        },
      }),
      new Map(),
    ),
    ['fixture.yml#ci#gate'],
  );
  assert.deepEqual(
    unguardedSteps(
      fixture(
        { ci: { steps: [script] } },
        { defaults: { run: { shell: 'bash -o pipefail {0}' } } },
      ),
      new Map(),
    ),
    ['fixture.yml#ci#gate'],
  );

  // A step-level shell overrides a dropped-errexit default rather than
  // inheriting it.
  assert.deepEqual(
    unguardedSteps(
      fixture(
        { ci: { steps: [{ ...script, shell: 'bash' }] } },
        { defaults: { run: { shell: 'bash -o pipefail {0}' } } },
      ),
      new Map(),
    ),
    [],
  );
});

test('staleExemptions deletes an entry its step no longer needs', () => {
  const dropped = {
    name: 'gate',
    shell: 'bash -o pipefail {0}',
    run: 'npm run build\nnpm test',
  };
  const allowlist = new Map([['fixture.yml#ci#gate', 'because']]);

  assert.deepEqual(
    staleExemptions(fixture({ ci: { steps: [dropped] } }), allowlist),
    [],
  );
  assert.deepEqual(
    staleExemptions(
      fixture({ ci: { steps: [{ ...dropped, shell: 'bash' }] } }),
      allowlist,
    ),
    [
      'fixture.yml#ci#gate (no longer a custom POSIX shell — delete this entry)',
    ],
  );
  assert.deepEqual(
    staleExemptions(
      fixture({
        ci: { steps: [{ ...dropped, shell: 'bash -eo pipefail {0}' }] },
      }),
      allowlist,
    ),
    ['fixture.yml#ci#gate (now asks for errexit — delete this entry)'],
  );
  assert.deepEqual(
    staleExemptions(
      fixture({
        ci: {
          steps: [{ ...dropped, run: 'set -e\nnpm run build\nnpm test' }],
        },
      }),
      allowlist,
    ),
    ['fixture.yml#ci#gate (now asks for errexit — delete this entry)'],
  );
  assert.deepEqual(
    staleExemptions(
      fixture({ ci: { steps: [{ ...dropped, run: 'npm test' }] } }),
      allowlist,
    ),
    ['fixture.yml#ci#gate (now a single command — delete this entry)'],
  );
  assert.deepEqual(
    staleExemptions(
      fixture({ ci: { steps: [{ ...dropped, name: 'other' }] } }),
      allowlist,
    ),
    ['fixture.yml#ci#gate (no such step)'],
  );
  assert.deepEqual(staleExemptions(fixture({ other: {} }), allowlist), [
    'fixture.yml#ci#gate (no such job)',
  ]);
});

test('staleExemptions matches an unnamed step by its command', () => {
  const run = 'npm run build\nnpm test';
  const allowlist = new Map([[`fixture.yml#ci#${run}`, 'because']]);
  assert.deepEqual(
    staleExemptions(
      fixture({ ci: { steps: [{ shell: 'bash -o pipefail {0}', run }] } }),
      allowlist,
    ),
    [],
  );
});

test('isWorkflowFile accepts both workflow extensions', () => {
  // The directory holds only `.yml` today; `.yaml` is equally valid to Actions
  // and a workflow added under it must not escape the scanner here.
  assert.equal(isWorkflowFile('ci.yml'), true);
  assert.equal(isWorkflowFile('ci.yaml'), true);
  assert.equal(isWorkflowFile('README.md'), false);
  assert.equal(isWorkflowFile('ci.yml.bak'), false);
});

test('the errexit exemption list does not outlive its steps', () => {
  assert.deepEqual(
    reasonlessExemptions(ERREXIT_EXEMPT_STEPS),
    [],
    'every allowlist entry must record why fail-fast may be dropped',
  );
  assert.deepEqual(
    staleExemptions(workflows, ERREXIT_EXEMPT_STEPS),
    [],
    'stale entries in ERREXIT_EXEMPT_STEPS',
  );
});

test('reasonlessExemptions names an entry with no argument behind it', () => {
  // Exercised through a populated fixture because the real allowlist is
  // empty: an entry added later without a reason has to be caught the first
  // time, not the first time somebody also writes this test.
  assert.deepEqual(reasonlessExemptions(new Map()), []);
  assert.deepEqual(
    reasonlessExemptions(new Map([['fixture.yml#ci#gate', 'because']])),
    [],
  );
  assert.deepEqual(
    reasonlessExemptions(
      new Map([
        ['fixture.yml#ci#empty', ''],
        ['fixture.yml#ci#missing', undefined],
        ['fixture.yml#ci#ok', 'because'],
      ]),
    ),
    ['fixture.yml#ci#empty', 'fixture.yml#ci#missing'],
  );
});
