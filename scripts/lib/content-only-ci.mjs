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

export function runDocumentLint(encoded, runCommand = spawnSync) {
  const documents = decodeChangedDocuments(encoded);
  if (documents.length === 0) return { documents, checked: [] };

  const markdown = documents.filter((path) => path.endsWith('.md'));
  const commands = [
    ['npx', ['prettier', '--check', ...documents]],
    ['npx', ['cspell', '--no-progress', '-c', '.cspell.yml', ...documents]],
  ];
  if (markdown.length > 0) {
    commands.push([
      'npx',
      ['--no-install', 'markdownlint', '-c', '.markdownlint.yaml', ...markdown],
    ]);
  }

  for (const [command, args] of commands) {
    const result = runCommand(command, args, {
      cwd: REPOSITORY_ROOT,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `${command} ${args[0]} failed with status ${result.status}`,
      );
    }
  }
  return { documents, checked: commands.map(([, args]) => args[0]) };
}
