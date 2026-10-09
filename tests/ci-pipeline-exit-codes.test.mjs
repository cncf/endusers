// Guards the exit code of a `run:` step whose command is a pipeline.
//
// GitHub's documented defaults: "By default, fail-fast behavior is enforced
// using `set -e` for both `sh` and `bash`. When `shell: bash` is specified,
// `-o pipefail` is also applied" — and a custom template string such as
// `bash -o pipefail {0}` takes full control of the shell parameters. So
// pipefail is off unless the step asks for it, and without it a pipeline
// exits with the status of its *last* command.
//
// ci.yml runs the entire unit suite and all five coverage thresholds through
// one:
//
//     run: npm run test:unit:coverage:check | tee coverage-summary.txt
//     shell: bash -o pipefail {0}
//
// Delete that second line and the step's exit code becomes `tee`'s, which is
// 0 whenever it can write the file. The gate then runs, prints its failure
// into the job log and the step summary, and reports success.
//
// Nothing else in the suite sees that. tests/ci-gating-jobs.test.mjs guards
// `continue-on-error` and says in its own header that it is the only thing
// standing between a gate and a job that reports success regardless;
// `continue-on-error` is not what is missing here. tests/
// coverage-gate-thresholds.test.mjs pins the threshold values and that ci.yml
// runs the gate command — both survive the exit code being discarded, because
// the command is still run and the thresholds are still passed to it.
// tests/workflow-scripts.test.mjs asks only whether a command is run by some
// workflow.
//
// The rule enforced is deliberately broader than that one step: any `run:`
// step containing a real pipeline must have pipefail in effect, whether from
// its shell or from a `set -o pipefail` in the script body. A workflow that
// pipes a command into `tee`, `head`, `jq` or a `while read` loop and does not
// ask for pipefail is discarding the exit code of everything but the last
// stage, and whether that matters is a question worth answering in the diff
// rather than in a post-mortem.
//
// The allowlist below follows the NON_GATING_JOBS convention in
// ci-gating-jobs.test.mjs: a step that genuinely wants the last stage's status
// stays possible, but it has to be argued for here rather than slipped in, and
// the staleness guard deletes the entry once the step stops needing it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(repoRoot, '.github', 'workflows');

// `<workflow>#<job>#<step name>` → why that pipeline may keep the last stage's
// exit status. Empty: every pipeline in the repository asks for pipefail
// today, either through `shell:` or through `set -euo pipefail`.
const PIPEFAIL_EXEMPT_STEPS = new Map([]);

// The step that this contract exists for, named so that the failure points at
// the gate that was disarmed rather than at a set difference.
const GUARDED_GATE = {
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

// `-o pipefail`, `-eo pipefail`, `-euo pipefail`: the option letter may sit at
// the end of a bundled short-flag cluster, and `pipefail` is its argument.
const PIPEFAIL_OPTION = /(?:^|\s)-[A-Za-z]*o\s+pipefail(?:\s|$)/;
const SET_PIPEFAIL = /(?:^|[\s;&|(])set\s+-[A-Za-z]*o\s+pipefail(?:\s|$|;)/;

// Shell keywords GitHub documents as applying `-o pipefail` for us. `sh` is
// absent on purpose: it gets `set -e` only. So is the no-`shell:` default,
// which is `bash -e {0}` — fail-fast, but pipelines still report their last
// stage.
const PIPEFAIL_BY_DEFAULT = new Set(['bash', 'pwsh', 'powershell']);

function effectiveShell(step, job, workflow) {
  return (
    step?.shell ??
    job?.defaults?.run?.shell ??
    workflow?.defaults?.run?.shell ??
    null
  );
}

// A shell keyword is matched whole; anything containing `{0}` is a custom
// template that took control of the parameters, so only what it spells out
// counts.
function shellAppliesPipefail(shell) {
  if (shell === null || shell === undefined) return false;
  const text = String(shell).trim();
  if (PIPEFAIL_BY_DEFAULT.has(text)) return true;
  return PIPEFAIL_OPTION.test(text);
}

// Removes comments and the contents of quoted spans, so that a `|` inside
// `--jq '.[] | @tsv'` is not read as a pipeline. Newlines are preserved
// because the case-pattern pass below is line-oriented.
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
      // A line continuation still joins two lines; any other escaped
      // character is a literal and cannot start a pipeline.
      out += run[i + 1] === '\n' ? '\n' : ' ';
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

// `case` alternatives are separated by `|` and are not pipelines. Inside a
// `case ... esac` block, drop any line that is only a pattern list — no
// parenthesis other than the one that closes it, and nothing after it. That is
// the shape the repository actually writes (`'' | *[!0-9A-Za-z.+-]*)`), and
// keeping the rule that narrow means a pattern sharing its line with a command
// is still scanned rather than silently skipped.
function dropCasePatterns(text) {
  const lines = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    const opens = (line.match(/(?:^|\s)case(?=\s|$)/g) ?? []).length;
    const closes = (line.match(/(?:^|\s|;)esac(?=\s|$|;)/g) ?? []).length;
    const isPattern = depth > 0 && /^[^()]*\)\s*$/.test(line);
    lines.push(isPattern ? '' : line);
    depth = Math.max(0, depth + opens - closes);
  }
  return lines.join('\n');
}

// True when the script runs at least one pipeline. `||` is a list operator,
// `>|` a clobbering redirect; `|&` is a pipeline and stays.
function hasPipeline(run) {
  if (typeof run !== 'string') return false;
  const bare = dropCasePatterns(stripQuotedAndComments(run))
    .replace(/\|\|/g, ' ')
    .replace(/>\|/g, ' ');
  return bare.includes('|');
}

function declaresPipefail(run) {
  return typeof run === 'string' && SET_PIPEFAIL.test(run);
}

function unguardedPipelines(parsedWorkflows, allowlist) {
  const offenders = [];
  for (const [file, workflow] of parsedWorkflows) {
    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (!hasPipeline(step?.run)) continue;
        const key = `${file}#${jobName}#${step.name ?? step.run}`;
        if (allowlist.has(key)) continue;
        if (shellAppliesPipefail(effectiveShell(step, job, workflow))) continue;
        if (declaresPipefail(step.run)) continue;
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
    if (!hasPipeline(step.run)) {
      stale.push(`${key} (no longer a pipeline — delete this entry)`);
      continue;
    }
    if (
      shellAppliesPipefail(effectiveShell(step, job, workflow)) ||
      declaresPipefail(step.run)
    ) {
      stale.push(`${key} (now asks for pipefail — delete this entry)`);
    }
  }
  return stale;
}

// Smallest shape the scanners read: one workflow file, one job, its steps.
function fixture(jobs, extra = {}) {
  return new Map([['fixture.yml', { ...extra, jobs }]]);
}

test('every piped run step in the repository keeps its pipeline exit code', () => {
  assert.ok(
    workflowFiles.length > 0,
    'no workflows found under .github/workflows',
  );
  assert.deepEqual(
    unguardedPipelines(workflows, PIPEFAIL_EXEMPT_STEPS),
    [...PIPEFAIL_EXEMPT_STEPS.keys()].sort(),
    'these run steps pipe a command somewhere without pipefail, so the step ' +
      'reports the exit code of the last stage and the rest of the pipeline ' +
      'can fail unnoticed',
  );
});

test('the unit coverage gate still reaches the job through its pipe', () => {
  const workflow = workflows.get(GUARDED_GATE.file);
  const job = workflow?.jobs?.[GUARDED_GATE.job];
  assert.ok(
    job,
    `${GUARDED_GATE.file} no longer defines the ${GUARDED_GATE.job} job`,
  );

  const step = (job.steps ?? []).find((one) => one.name === GUARDED_GATE.step);
  assert.ok(step, `"${GUARDED_GATE.step}" is gone from ${GUARDED_GATE.job}`);

  // Asserted rather than skipped past: if a future change stops piping the
  // gate, this guard has nothing left to protect and should be deleted in
  // that change rather than sitting here reporting green over nothing.
  assert.ok(
    hasPipeline(step.run),
    `"${GUARDED_GATE.step}" no longer pipes its command anywhere, so this ` +
      'test guards nothing — delete it along with GUARDED_GATE',
  );

  assert.ok(
    shellAppliesPipefail(effectiveShell(step, job, workflow)) ||
      declaresPipefail(step.run),
    `"${GUARDED_GATE.step}" pipes the coverage gate into another command ` +
      "without pipefail: the step would report tee's exit code, so the unit " +
      'suite and every coverage threshold would stop failing the build',
  );
});

test('unguardedPipelines names an unnamed step by its command', () => {
  // `step.name` is optional; without the fallback the key would be
  // `fixture.yml#ci#undefined` and two unnamed steps would collide.
  assert.deepEqual(
    unguardedPipelines(
      fixture({ ci: { steps: [{ run: 'npm test | tee out.txt' }] } }),
      new Map(),
    ),
    ['fixture.yml#ci#npm test | tee out.txt'],
  );
});

test('unguardedPipelines tolerates a workflow with no jobs or steps', () => {
  // A reusable-workflow stub or a job that is only `uses:` has neither, and
  // the scanner reads every file in the directory rather than a chosen set.
  assert.deepEqual(unguardedPipelines(fixture({}), new Map()), []);
  assert.deepEqual(unguardedPipelines(fixture({ ci: {} }), new Map()), []);
  assert.deepEqual(
    unguardedPipelines(new Map([['fixture.yml', null]]), new Map()),
    [],
  );
});

test('staleExemptions matches an unnamed step by its command', () => {
  const allowlist = new Map([['fixture.yml#ci#x | y', 'because']]);
  assert.deepEqual(
    staleExemptions(fixture({ ci: { steps: [{ run: 'x | y' }] } }), allowlist),
    [],
  );
  assert.deepEqual(staleExemptions(fixture({ ci: {} }), allowlist), [
    'fixture.yml#ci#x | y (no such step)',
  ]);
});

test('isWorkflowFile accepts both workflow extensions', () => {
  // The directory holds only `.yml` today; `.yaml` is equally valid to Actions
  // and a workflow added under it must not escape every scanner here.
  assert.equal(isWorkflowFile('ci.yml'), true);
  assert.equal(isWorkflowFile('ci.yaml'), true);
  assert.equal(isWorkflowFile('README.md'), false);
  assert.equal(isWorkflowFile('ci.yml.bak'), false);
});

test('the pipefail exemption list does not outlive its steps', () => {
  for (const [key, reason] of PIPEFAIL_EXEMPT_STEPS) {
    assert.ok(
      typeof reason === 'string' && reason.length > 0,
      `allowlist entry ${key} must record why the exit code may be dropped`,
    );
  }
  assert.deepEqual(
    staleExemptions(workflows, PIPEFAIL_EXEMPT_STEPS),
    [],
    'stale entries in PIPEFAIL_EXEMPT_STEPS',
  );
});

test('hasPipeline separates a pipeline from the other uses of "|"', () => {
  assert.equal(hasPipeline('npm test | tee out.txt'), true);
  assert.equal(hasPipeline('grep x file |& cat'), true);
  assert.equal(hasPipeline('npm test'), false);
  assert.equal(hasPipeline(undefined), false);

  // List operator, not a pipeline.
  assert.equal(hasPipeline('npm test || echo failed'), false);
  assert.equal(hasPipeline('[[ -z "$a" || -z "$b" ]] && exit 1'), false);

  // Clobbering redirect.
  assert.equal(hasPipeline('echo hi >| out.txt'), false);

  // Quoted and commented pipes belong to the argument, not the shell.
  assert.equal(hasPipeline("gh api --jq '.[] | @tsv' repos/o/r"), false);
  assert.equal(hasPipeline('echo "a | b"'), false);
  assert.equal(hasPipeline('echo a \\| b'), false);
  assert.equal(hasPipeline('# npm test | tee out.txt\nnpm test'), false);
  assert.equal(hasPipeline('npm test # piped? | no'), false);

  // A real pipeline that follows a quoted one is still found.
  assert.equal(hasPipeline("echo 'a | b' | tee out.txt"), true);

  // Quoted spans keep their newlines, so a later line is still scanned on its
  // own rather than being folded into the one the quote opened on.
  assert.equal(hasPipeline("echo '\nnot a pipeline | here\n'"), false);
  assert.equal(hasPipeline('echo "a\nb"\nnpm test | tee out.txt'), true);
  assert.equal(hasPipeline('echo "a \\\nb" | tee out.txt'), true);
});

test('hasPipeline does not read case alternatives as pipelines', () => {
  // The shape ci.yml writes when validating the Playwright version.
  const caseBlock = [
    'version="$(node -p "require(\'./package-lock.json\').version")"',
    'case "$version" in',
    "  '' | *[!0-9A-Za-z.+-]*)",
    '    exit 1',
    '    ;;',
    'esac',
  ].join('\n');
  assert.equal(hasPipeline(caseBlock), false);

  // Closing the block puts the scanner back on duty.
  assert.equal(hasPipeline(`${caseBlock}\nnpm test | tee out.txt`), true);

  // A pattern that shares its line with a command is still scanned, so the
  // narrow rule cannot be used to hide a pipeline.
  assert.equal(
    hasPipeline('case "$x" in\n  a) npm test | tee out.txt ;;\nesac'),
    true,
  );
});

test('shellAppliesPipefail reads keywords and custom templates apart', () => {
  assert.equal(shellAppliesPipefail('bash'), true);
  assert.equal(shellAppliesPipefail(' bash '), true);
  assert.equal(shellAppliesPipefail('pwsh'), true);
  assert.equal(shellAppliesPipefail('bash -o pipefail {0}'), true);
  assert.equal(shellAppliesPipefail('bash -eo pipefail {0}'), true);
  assert.equal(
    shellAppliesPipefail('bash --noprofile --norc -euo pipefail {0}'),
    true,
  );

  // `sh` gets `set -e` only, and a template that does not spell out pipefail
  // does not get it from anywhere else.
  assert.equal(shellAppliesPipefail('sh'), false);
  assert.equal(shellAppliesPipefail('bash {0}'), false);
  assert.equal(shellAppliesPipefail('bash -e {0}'), false);
  assert.equal(shellAppliesPipefail('python'), false);
  assert.equal(shellAppliesPipefail(null), false);
  assert.equal(shellAppliesPipefail(undefined), false);
});

test('unguardedPipelines reports a piped step that drops its exit code', () => {
  const piped = { name: 'gate', run: 'npm test | tee out.txt' };

  assert.deepEqual(
    unguardedPipelines(fixture({ ci: { steps: [piped] } }), new Map()),
    ['fixture.yml#ci#gate'],
  );

  // Each of the three ways to ask for pipefail clears it.
  assert.deepEqual(
    unguardedPipelines(
      fixture({ ci: { steps: [{ ...piped, shell: 'bash' }] } }),
      new Map(),
    ),
    [],
  );
  assert.deepEqual(
    unguardedPipelines(
      fixture({ ci: { steps: [{ ...piped, shell: 'bash -o pipefail {0}' }] } }),
      new Map(),
    ),
    [],
  );
  assert.deepEqual(
    unguardedPipelines(
      fixture({
        ci: {
          steps: [
            { name: 'gate', run: 'set -euo pipefail\nnpm test | tee out.txt' },
          ],
        },
      }),
      new Map(),
    ),
    [],
  );

  // A step with no pipeline is not the contract's business, and `uses:` steps
  // have no `run` at all.
  assert.deepEqual(
    unguardedPipelines(
      fixture({
        ci: { steps: [{ name: 'plain', run: 'npm test' }, { uses: 'a/b@v1' }] },
      }),
      new Map(),
    ),
    [],
  );

  // The allowlist suppresses exactly its own key.
  assert.deepEqual(
    unguardedPipelines(
      fixture({ ci: { steps: [piped] } }),
      new Map([['fixture.yml#ci#gate', 'because']]),
    ),
    [],
  );
});

test('unguardedPipelines honours job- and workflow-level shell defaults', () => {
  const piped = { name: 'gate', run: 'npm test | tee out.txt' };

  assert.deepEqual(
    unguardedPipelines(
      fixture({ ci: { defaults: { run: { shell: 'bash' } }, steps: [piped] } }),
      new Map(),
    ),
    [],
  );
  assert.deepEqual(
    unguardedPipelines(
      fixture(
        { ci: { steps: [piped] } },
        { defaults: { run: { shell: 'bash' } } },
      ),
      new Map(),
    ),
    [],
  );

  // A step-level shell overrides a pipefail default rather than inheriting it.
  assert.deepEqual(
    unguardedPipelines(
      fixture(
        { ci: { steps: [{ ...piped, shell: 'sh' }] } },
        { defaults: { run: { shell: 'bash' } } },
      ),
      new Map(),
    ),
    ['fixture.yml#ci#gate'],
  );
});

test('staleExemptions deletes an entry its step no longer needs', () => {
  const guarded = fixture({
    ci: {
      steps: [{ name: 'gate', run: 'npm test | tee out.txt', shell: 'bash' }],
    },
  });
  const unguarded = fixture({
    ci: { steps: [{ name: 'gate', run: 'npm test | tee out.txt' }] },
  });
  const allowlist = new Map([['fixture.yml#ci#gate', 'because']]);

  assert.deepEqual(staleExemptions(unguarded, allowlist), []);
  assert.deepEqual(staleExemptions(guarded, allowlist), [
    'fixture.yml#ci#gate (now asks for pipefail — delete this entry)',
  ]);
  assert.deepEqual(
    staleExemptions(
      fixture({ ci: { steps: [{ name: 'gate', run: 'npm test' }] } }),
      allowlist,
    ),
    ['fixture.yml#ci#gate (no longer a pipeline — delete this entry)'],
  );
  assert.deepEqual(
    staleExemptions(
      fixture({ ci: { steps: [{ name: 'other', run: 'x | y' }] } }),
      allowlist,
    ),
    ['fixture.yml#ci#gate (no such step)'],
  );
  assert.deepEqual(staleExemptions(fixture({ other: {} }), allowlist), [
    'fixture.yml#ci#gate (no such job)',
  ]);
});
