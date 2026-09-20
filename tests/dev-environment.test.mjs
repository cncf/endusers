import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

// The Justfile and .devcontainer/devcontainer.json are the two entry points a
// contributor uses before CI ever sees the change. Both reach into
// package.json and into the Node version CI pins, entirely through strings,
// and nothing in the suite reads either file: a renamed script or a bumped
// runtime leaves them silently stale.
const root = new URL('..', import.meta.url).pathname;

const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
const scriptNames = new Set(Object.keys(packageJson.scripts ?? {}));

const justfile = readFileSync(join(root, 'Justfile'), 'utf8');

// Strips // and /* */ comments without touching sequences inside strings, so
// a URL such as "https://example.com" survives. devcontainer.json is JSON
// with Comments: JSON.parse rejects it, and the repo has no jsonc dependency.
function stripJsonComments(source) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += source[i + 1] ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

const devcontainerRaw = readFileSync(
  join(root, '.devcontainer/devcontainer.json'),
  'utf8',
);

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

function npmRunTargets(commands) {
  const targets = [];
  for (const command of commands) {
    for (const [, name] of command.matchAll(
      /npm\s+run\s+(?:-s\s+)?([\w:.-]+)/g,
    )) {
      targets.push(name);
    }
  }
  return targets;
}

const justRecipes = parseJustRecipes(justfile);

test('Justfile declares recipes with non-empty bodies', () => {
  assert.ok(justRecipes.size > 0, 'no recipes parsed out of Justfile');
  for (const [name, body] of justRecipes) {
    assert.ok(body.length > 0, `just recipe "${name}" has an empty body`);
  }
});

test('every npm script invoked by a Justfile recipe exists in package.json', () => {
  const missing = [];
  for (const [name, body] of justRecipes) {
    for (const target of npmRunTargets(body)) {
      if (!scriptNames.has(target)) missing.push(`${name}: npm run ${target}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Justfile recipes invoke undefined package.json scripts:\n${missing.join('\n')}`,
  );
});

test('devcontainer.json parses and pins an image and a container user', () => {
  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  assert.equal(typeof devcontainer, 'object');
  assert.ok(devcontainer !== null);
  assert.equal(
    typeof devcontainer.image,
    'string',
    'devcontainer.json declares no image',
  );
  assert.ok(devcontainer.image.length > 0, 'devcontainer.json image is empty');
  assert.equal(
    typeof devcontainer.containerUser,
    'string',
    'devcontainer.json declares no containerUser',
  );
});

test('every npm script invoked by devcontainer lifecycle commands exists', () => {
  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  const lifecycleKeys = [
    'initializeCommand',
    'onCreateCommand',
    'updateContentCommand',
    'postCreateCommand',
    'postStartCommand',
    'postAttachCommand',
  ];
  const commands = [];
  for (const key of lifecycleKeys) {
    const value = devcontainer[key];
    if (typeof value === 'string') commands.push(value);
    else if (Array.isArray(value)) commands.push(value.join(' '));
    else if (value && typeof value === 'object')
      commands.push(...Object.values(value).map((v) => String(v)));
  }
  const missing = npmRunTargets(commands).filter(
    (target) => !scriptNames.has(target),
  );
  assert.deepEqual(
    missing,
    [],
    `devcontainer lifecycle commands invoke undefined package.json scripts: ${missing.join(', ')}`,
  );
});

// The dev port the devcontainer forwards has to be the one `just serve`
// actually opens, or the recipe starts a server nobody outside the container
// can reach.
test('devcontainer forwards the port the docusaurus dev server serves on', () => {
  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  const forwarded = (devcontainer.forwardPorts ?? []).map((port) =>
    typeof port === 'string' ? Number(port.split(':').pop()) : port,
  );
  const serveRecipe = (justRecipes.get('serve') ?? []).join(' ');
  assert.match(
    serveRecipe,
    /docus:start/,
    'just serve no longer starts the docusaurus dev server; update this test',
  );
  const configured = serveRecipe.match(/--port[ =](\d+)/);
  const expected = configured ? Number(configured[1]) : 3000;
  assert.ok(
    forwarded.includes(expected),
    `devcontainer forwardPorts ${JSON.stringify(forwarded)} omits the dev-server port ${expected}`,
  );
});

// README.md, CONTRIBUTING.md and AGENTS.md document the commands a
// contributor is told to run. A renamed package.json script turns those
// blocks into instructions that fail on the first copy-paste.
const DEV_DOCS = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md'];

test('every npm script documented in the developer docs exists', () => {
  const missing = [];
  for (const doc of DEV_DOCS) {
    const source = readFileSync(join(root, doc), 'utf8');
    for (const target of npmRunTargets(source.split('\n'))) {
      if (!scriptNames.has(target)) missing.push(`${doc}: npm run ${target}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `developer docs invoke undefined package.json scripts:\n${missing.join('\n')}`,
  );
});

// Node majors: the devcontainer feature, and every workflow that sets one,
// have to agree. A contributor whose container runs a different major than CI
// reproduces neither its successes nor its failures.
function workflowNodeMajors() {
  const dir = join(root, '.github/workflows');
  const found = [];
  for (const file of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const doc = parseYaml(readFileSync(join(dir, file), 'utf8'));
    const envVersion = doc?.env?.NODE_VERSION;
    if (envVersion !== undefined)
      found.push({ file, version: String(envVersion) });
    for (const job of Object.values(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const version = step?.with?.['node-version'];
        if (version === undefined) continue;
        const literal = String(version);
        // `${{ env.NODE_VERSION }}` is recorded through the env entry above.
        if (literal.includes('${{')) continue;
        found.push({ file, version: literal });
      }
    }
  }
  return found;
}

function devcontainerNodeMajor() {
  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  const features = devcontainer.features ?? {};
  const nodeKey = Object.keys(features).find((key) =>
    /(^|\/)node(:\d+)?$/.test(key),
  );
  assert.ok(nodeKey, 'devcontainer declares no node feature');
  const major = String(features[nodeKey]?.version ?? '').split('.')[0];
  assert.match(
    major,
    /^\d+$/,
    `devcontainer node feature has no numeric version: ${JSON.stringify(features[nodeKey])}`,
  );
  return major;
}

test('devcontainer Node major matches the Node major every workflow pins', () => {
  const devcontainerMajor = devcontainerNodeMajor();
  const workflowVersions = workflowNodeMajors();
  assert.ok(
    workflowVersions.length > 0,
    'no workflow pins a Node version; update this test',
  );
  const mismatched = workflowVersions.filter(
    ({ version }) => version.split('.')[0] !== devcontainerMajor,
  );
  assert.deepEqual(
    mismatched,
    [],
    `workflows pin a Node major the devcontainer does not (devcontainer: ${devcontainerMajor}): ${mismatched
      .map(({ file, version }) => `${file}=${version}`)
      .join(', ')}`,
  );
});

// CONTRIBUTING.md tells a contributor which Node to install. If that drifts
// below the major CI and the devcontainer run on, the documented setup is one
// a maintainer never reproduces.
test('the documented Node prerequisite matches the pinned Node major', () => {
  const devcontainerMajor = Number(devcontainerNodeMajor());
  const documented = [];
  for (const doc of DEV_DOCS) {
    const source = readFileSync(join(root, doc), 'utf8');
    for (const [, major] of source.matchAll(
      /Node(?:\.js)?\s+v?(\d+)(?:\.\d+)*\s*\+?/gi,
    )) {
      documented.push({ doc, major: Number(major) });
    }
  }
  assert.ok(
    documented.length > 0,
    'no developer doc states a Node prerequisite; update this test',
  );
  const wrong = documented.filter(({ major }) => major !== devcontainerMajor);
  assert.deepEqual(
    wrong,
    [],
    `developer docs state a Node major other than the pinned ${devcontainerMajor}: ${wrong
      .map(({ doc, major }) => `${doc}=${major}`)
      .join(', ')}`,
  );
});
