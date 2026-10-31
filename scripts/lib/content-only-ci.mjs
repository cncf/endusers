import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const ROOT_DOCUMENTS = new Set([
  'CODE_OF_CONDUCT.md',
  'CONTENT-SECURITY.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'MAINTAINERS.md',
  'README.md',
  'SECURITY.md',
]);

const DATA_BACKED_DOCUMENTS = new Set([
  'docs/community/awards.md',
  'docs/community/members.md',
  'docs/community/projects-born.md',
  'docs/events/index.md',
  'docs/events/2026/kubecon-na.md',
  'docs/resources/case-studies.md',
  'docs/resources/changelog.md',
  'docs/resources/metrics.md',
  'docs/resources/radar-reports.md',
]);

function isRegularDocumentFile(path) {
  const absolutePath = resolve(REPOSITORY_ROOT, path);
  return existsSync(absolutePath) && lstatSync(absolutePath).isFile();
}

export function isAuthoredDocumentPath(path) {
  if (
    typeof path !== 'string' ||
    path.includes('\\') ||
    isAbsolute(path) ||
    path.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    return false;
  }

  if (!/\.mdx?$/.test(path) || DATA_BACKED_DOCUMENTS.has(path)) return false;

  if (path.startsWith('docs/architectures/')) {
    return (
      path === 'docs/architectures/index.md' ||
      path === 'docs/architectures/submit.md'
    );
  }

  if (
    path.startsWith('docs/') ||
    path.startsWith('blog/') ||
    path.startsWith('adr/')
  ) {
    return true;
  }

  return ROOT_DOCUMENTS.has(path);
}

export function parseNameStatus(output) {
  if (typeof output !== 'string') return null;
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();

  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    const path = fields[index + 1];
    if (
      !/^(?:A|M|D|T|U|X|B)$/.test(status) ||
      typeof path !== 'string' ||
      path.length === 0
    ) {
      return null;
    }
    changes.push({ status, path });
    index += 2;
  }
  return changes;
}

export function classifyChanges(eventName, baseSha, changes) {
  if (
    !['pull_request', 'merge_group'].includes(eventName) ||
    !/^[0-9a-f]{40}$/i.test(baseSha) ||
    !Array.isArray(changes) ||
    changes.length === 0
  ) {
    return { documentOnly: false, documents: [] };
  }

  const documents = new Set();
  for (const change of changes) {
    if (
      !change ||
      !['A', 'M', 'D'].includes(change.status) ||
      !isAuthoredDocumentPath(change.path)
    ) {
      return { documentOnly: false, documents: [] };
    }
    if (change.status === 'D') continue;
    if (!isRegularDocumentFile(change.path)) {
      return { documentOnly: false, documents: [] };
    }
    documents.add(change.path);
  }

  return {
    documentOnly: true,
    documents: [...documents],
  };
}

export function baseShaForEvent(eventName, environment = process.env) {
  if (eventName === 'pull_request') return environment.PR_BASE_SHA;
  if (eventName === 'merge_group') return environment.MERGE_BASE_SHA;
  return null;
}

export function writeOutputs(result, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required');

  appendFileSync(
    outputPath,
    [
      `document_only=${result.documentOnly}`,
      `documents_b64=${Buffer.from(JSON.stringify(result.documents)).toString('base64')}`,
      '',
    ].join('\n'),
  );
}

export function classifyCurrentEvent(
  environment = process.env,
  readDiff = execFileSync,
  warn = console.warn,
) {
  const eventName = environment.GITHUB_EVENT_NAME;
  const baseSha = baseShaForEvent(eventName, environment);

  if (!/^[0-9a-f]{40}$/i.test(baseSha)) {
    return { documentOnly: false, documents: [] };
  }

  let output;
  try {
    output = readDiff(
      'git',
      ['diff', '--name-status', '-z', '--no-renames', baseSha, 'HEAD', '--'],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    );
  } catch (error) {
    warn(
      `Could not classify changed paths; using full validation: ${error.message}`,
    );
    return { documentOnly: false, documents: [] };
  }

  const changes = parseNameStatus(output);
  return classifyChanges(eventName, baseSha, changes);
}

export function runClassifier(
  environment = process.env,
  classify = classifyCurrentEvent,
  log = console.log,
) {
  const result = classify(environment);
  writeOutputs(result, environment.GITHUB_OUTPUT);
  log(
    result.documentOnly
      ? `Document-only change: ${result.documents.length} changed document(s)`
      : 'Using full validation',
  );
  return result;
}

export function decodeChangedDocuments(encoded) {
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new Error('CHANGED_DOCUMENTS_B64 must be a non-empty base64 string');
  }

  let documents;
  try {
    documents = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error('CHANGED_DOCUMENTS_B64 must encode a JSON document list', {
      cause: error,
    });
  }
  if (!Array.isArray(documents)) {
    throw new Error('CHANGED_DOCUMENTS_B64 must encode a JSON document list');
  }

  const uniqueDocuments = new Set();
  for (const path of documents) {
    if (!isAuthoredDocumentPath(path)) {
      throw new Error(`Not an authored document path: ${String(path)}`);
    }
    if (!isRegularDocumentFile(path)) {
      throw new Error(`Changed document does not exist: ${path}`);
    }
    uniqueDocuments.add(path);
  }
  return [...uniqueDocuments];
}

// Advisory checks on the document-only path (ADR 0011, amendment of
// 2026-10-30): their findings become workflow annotations and a step-summary
// entry, never a failed check. Each parser turns the tool's stdout into
// annotations; `fix` is the one-line repair shown next to them.
const ADVISORY_CHECKS = [
  {
    name: 'prettier',
    args: (documents) => ['prettier', '--check', ...documents],
    parse: prettierAnnotations,
    fix: 'run `npm run fix:format`',
  },
  {
    name: 'cspell',
    args: (documents) => [
      'cspell',
      '--no-progress',
      '-c',
      '.cspell.yml',
      ...documents,
    ],
    parse: cspellAnnotations,
    fix: 'add the word to `.cspell.yml`, or to a `<!-- cspell:ignore Word -->` comment in the page when it is a proper noun',
  },
];

export function prettierAnnotations(output) {
  const annotations = [];
  for (const match of String(output).matchAll(/^\[warn\] (\S+)$/gmu)) {
    annotations.push({
      file: match[1],
      message: 'Formatting differs from Prettier output',
    });
  }
  return annotations;
}

export function cspellAnnotations(output) {
  const annotations = [];
  for (const match of String(output).matchAll(
    /(.+?):(\d+):(\d+) - Unknown word \((.+)\)$/gmu,
  )) {
    annotations.push({
      file: match[1],
      line: Number(match[2]),
      col: Number(match[3]),
      message: `Unknown word "${match[4]}"`,
    });
  }
  return annotations;
}

function escapeAnnotationMessage(message) {
  return message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

export function formatAnnotation({ file, line, col, message }) {
  const location =
    line === undefined
      ? `file=${file}`
      : `file=${file},line=${line},col=${col}`;
  return `::warning ${location}::${escapeAnnotationMessage(message)}`;
}

export function advisorySummary(findings) {
  if (findings.length === 0) return '';
  const lines = [
    '## Advisory document checks',
    '',
    'These do not block a document-only pull request; a reviewer may still ask for the fix.',
    '',
  ];
  for (const { check, annotations } of findings) {
    lines.push(
      `- \`${check.name}\`: ${annotations.length} finding(s); ${check.fix}.`,
    );
    for (const annotation of annotations) {
      const where =
        annotation.line === undefined
          ? annotation.file
          : `${annotation.file}:${annotation.line}:${annotation.col}`;
      lines.push(`  - \`${where}\` ${annotation.message}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function runAdvisoryCheck(check, documents, runCommand, log) {
  const args = check.args(documents);
  const result = runCommand('npx', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output.length > 0) log(output.trimEnd());
  if (result.status === 0) return [];

  const annotations = check.parse(output);
  if (annotations.length === 0) {
    // The tool failed without naming a document (a missing config, a crash);
    // keep that visible rather than reporting a clean run.
    annotations.push({
      file: documents[0],
      message: `${check.name} exited with status ${result.status} without reporting a finding`,
    });
  }
  return annotations;
}

export function runDocumentLint(
  encoded,
  runCommand = spawnSync,
  {
    log = console.log,
    summaryPath = process.env.GITHUB_STEP_SUMMARY,
    appendSummary = appendFileSync,
  } = {},
) {
  const documents = decodeChangedDocuments(encoded);
  if (documents.length === 0) return { documents, checked: [], advisories: [] };

  const checked = [];
  const findings = [];
  for (const check of ADVISORY_CHECKS) {
    const annotations = runAdvisoryCheck(check, documents, runCommand, log);
    checked.push(check.name);
    if (annotations.length > 0) findings.push({ check, annotations });
  }
  for (const { annotations } of findings) {
    for (const annotation of annotations) log(formatAnnotation(annotation));
  }
  if (findings.length > 0 && summaryPath) {
    appendSummary(summaryPath, advisorySummary(findings));
  }

  const markdown = documents.filter((path) => path.endsWith('.md'));
  if (markdown.length > 0) {
    const args = [
      '--no-install',
      'markdownlint',
      '-c',
      '.markdownlint.yaml',
      ...markdown,
    ];
    const result = runCommand('npx', args, {
      cwd: REPOSITORY_ROOT,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`npx markdownlint failed with status ${result.status}`);
    }
    checked.push('markdownlint');
  }

  return {
    documents,
    checked,
    advisories: findings.flatMap(({ check, annotations }) =>
      annotations.map((annotation) => ({ check: check.name, ...annotation })),
    ),
  };
}
