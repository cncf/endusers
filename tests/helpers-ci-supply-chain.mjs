// The scanners behind ./ci-supply-chain.test.mjs.
//
// Each one walks a list of `{ name, source, doc }` workflow records and returns
// the offences it found, so the contract can assert an empty list over the real
// .github/workflows/** tree while ./ci-supply-chain-helpers.test.mjs drives the
// same functions over documents that do offend. Keeping them here is what makes
// the second half possible: a scanner that stopped detecting would otherwise
// leave the contract green against a tree it was no longer checking.

// `on` is parsed as the boolean true by YAML 1.1 compatibility rules, so the
// trigger block is read back through both keys.
export function triggers(doc) {
  const on = doc.on ?? doc[true];
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

export function jobs(doc) {
  return Object.entries(doc.jobs ?? {});
}

export function steps(doc) {
  return jobs(doc).flatMap(([jobName, job]) =>
    (job?.steps ?? []).map((step, index) => ({
      jobName,
      index,
      step,
    })),
  );
}

const SHA_PINNED = /^[^@]+@[0-9a-f]{40}$/;

export function unpinnedActions(workflows) {
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
  return unpinned;
}

export function actionsMissingVersionComment(workflows) {
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
  return missing;
}

export function jobsWithUnconstrainedToken(workflows) {
  const unconstrained = [];
  for (const { name, doc } of workflows) {
    if (doc.permissions) continue;
    for (const [jobName, job] of jobs(doc)) {
      if (!job?.permissions) unconstrained.push(`${name}: job ${jobName}`);
    }
  }
  return unconstrained;
}

export function blanketWriteScopes(workflows) {
  const blanket = [];
  for (const { name, doc } of workflows) {
    const scopes = [
      doc.permissions,
      ...jobs(doc).map(([, job]) => job?.permissions),
    ];
    for (const scope of scopes) {
      if (scope === 'write-all') blanket.push(name);
    }
  }
  return blanket;
}

export function checkoutSteps(doc) {
  return steps(doc).filter(({ step }) =>
    step?.uses?.startsWith('actions/checkout@'),
  );
}

export function persistsCredentials(step) {
  return step?.with?.['persist-credentials'] !== false;
}

export function credentialPersistingCheckouts(workflows, known) {
  const offenders = [];
  for (const { name, doc } of workflows) {
    if (known.has(name)) continue;
    for (const { jobName, index, step } of checkoutSteps(doc)) {
      if (persistsCredentials(step)) {
        offenders.push(`${name} (${jobName}, step ${index})`);
      }
    }
  }
  return offenders;
}

// Reasons an entry no longer belongs in the persist-credentials baseline:
// either it names a workflow that is gone, or that workflow has been fixed and
// the exception has to go with it.
export function persistingCheckoutBaselineProblems(workflows, known) {
  const problems = [];
  for (const name of known) {
    const entry = workflows.find((workflow) => workflow.name === name);
    if (!entry) {
      problems.push(
        `${name} is listed as a known persist-credentials gap but no such workflow exists; remove the entry`,
      );
      continue;
    }
    const offending = checkoutSteps(entry.doc).filter(({ step }) =>
      persistsCredentials(step),
    );
    if (offending.length === 0) {
      problems.push(
        `${name} now sets persist-credentials: false on every checkout; remove it from KNOWN_PERSISTING_CHECKOUTS so the gap cannot reopen`,
      );
    }
  }
  return problems;
}

// `timeout-minutes` is not accepted on a job that delegates to a reusable
// workflow, so those jobs are outside this contract.
export function boundableJobs(doc) {
  return jobs(doc).filter(([, job]) => !job?.uses);
}

export function timeoutOf(job) {
  return job?.['timeout-minutes'];
}

export function unboundedJobs(workflows, known) {
  const unbounded = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of boundableJobs(doc)) {
      const label = `${name}: ${jobName}`;
      if (known.has(label)) continue;
      if (timeoutOf(job) === undefined) unbounded.push(label);
    }
  }
  return unbounded;
}

// Describes why a declared timeout-minutes value is unusable, or null when the
// value is fine. A quoted YAML scalar parses as a string and a fractional value
// is silently floored by the runner, so neither is accepted; a value at or above
// 360 restates the 6-hour default this contract exists to replace.
export function timeoutProblem(declared) {
  if (typeof declared !== 'number') {
    return `timeout-minutes must be a number, got ${JSON.stringify(declared)}`;
  }
  if (!Number.isInteger(declared) || declared <= 0) {
    return `timeout-minutes must be a positive whole number of minutes, got ${declared}`;
  }
  if (declared >= 360) {
    return `timeout-minutes of ${declared} is at or above the 6-hour default it exists to replace`;
  }
  return null;
}

export function timeoutFaults(workflows) {
  const faults = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of boundableJobs(doc)) {
      const declared = timeoutOf(job);
      if (declared === undefined) continue;
      const problem = timeoutProblem(declared);
      if (problem) faults.push(`${name} (${jobName}): ${problem}`);
    }
  }
  return faults;
}

export function timeoutBaselineProblems(workflows, known) {
  const problems = [];
  for (const label of known) {
    const [name, jobName] = label.split(': ');
    const entry = workflows.find((workflow) => workflow.name === name);
    if (!entry) {
      problems.push(
        `${label} is listed as a known timeout gap but ${name} does not exist; remove the entry`,
      );
      continue;
    }
    const job = boundableJobs(entry.doc).find(([id]) => id === jobName);
    if (!job) {
      problems.push(
        `${label} is listed as a known timeout gap but ${name} declares no boundable job '${jobName}'; remove the entry`,
      );
      continue;
    }
    if (timeoutOf(job[1]) !== undefined) {
      problems.push(
        `${label} now declares timeout-minutes; remove it from KNOWN_UNBOUNDED_JOBS so the gap cannot reopen`,
      );
    }
  }
  return problems;
}

// Only jobs that request a GitHub-hosted runner directly are in scope: a job
// delegating to a reusable workflow declares no `runs-on`, and a self-hosted
// label set is the repository's own choice of image rather than a floating one.
export function runnerLabels(job) {
  const declared = job?.['runs-on'];
  if (declared === undefined) return [];
  if (typeof declared === 'string') return [declared];
  if (Array.isArray(declared)) return declared;
  if (Array.isArray(declared?.labels)) return declared.labels;
  return [declared];
}

// Names the reason a runner label is unpinned, or null when the label is fine.
// A non-string label cannot be checked for a version, and `self-hosted` opts the
// job out of GitHub's image rotation entirely.
export function floatingRunnerProblem(labels) {
  if (labels.some((label) => label === 'self-hosted')) return null;
  const faults = labels.filter(
    (label) => typeof label !== 'string' || /-latest$/.test(label),
  );
  if (faults.length === 0) return null;
  return `pins no runner image version: ${faults.map((label) => JSON.stringify(label)).join(', ')}`;
}

export function floatingRunnerJobs(workflows, known) {
  const floating = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of jobs(doc)) {
      const label = `${name}: ${jobName}`;
      if (known.has(label)) continue;
      const problem = floatingRunnerProblem(runnerLabels(job));
      if (problem) floating.push(`${label} ${problem}`);
    }
  }
  return floating;
}

export function jobsWithoutRunner(workflows) {
  const missing = [];
  for (const { name, doc } of workflows) {
    for (const [jobName, job] of jobs(doc)) {
      if (job?.uses) continue;
      if (runnerLabels(job).length === 0) missing.push(`${name}: ${jobName}`);
    }
  }
  return missing;
}

export function floatingRunnerBaselineProblems(workflows, known) {
  const problems = [];
  for (const label of known) {
    const [name, jobName] = label.split(': ');
    const entry = workflows.find((workflow) => workflow.name === name);
    if (!entry) {
      problems.push(
        `${label} is listed as a known floating-runner gap but ${name} does not exist; remove the entry`,
      );
      continue;
    }
    const job = jobs(entry.doc).find(([id]) => id === jobName);
    if (!job) {
      problems.push(
        `${label} is listed as a known floating-runner gap but ${name} declares no job '${jobName}'; remove the entry`,
      );
      continue;
    }
    if (floatingRunnerProblem(runnerLabels(job[1])) === null) {
      problems.push(
        `${label} now pins a versioned runner image; remove it from KNOWN_FLOATING_RUNNERS so the gap cannot reopen`,
      );
    }
  }
  return problems;
}
