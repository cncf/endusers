import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { stripJsonComments } from './helpers-jsonc.mjs';

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

// Features are the devcontainer's third-party code path: each one's
// install.sh is fetched at image build time and executed as root. A bare id
// ("node") is the deprecated pre-OCI shorthand the CLI rewrites to
// `ghcr.io/devcontainers/features/<id>:1`, and a bare registry path with no
// tag resolves to `:latest` -- both choose whatever upstream published most
// recently. The workflow actions are SHA-pinned and the npm tree is
// integrity-pinned, so this asserts the same for the one remaining surface.
const FEATURE_ID = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+:\d+\.\d+\.\d+$/;

test('every devcontainer feature is fully qualified and version-pinned', () => {
  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  const features = Object.keys(devcontainer.features ?? {});
  assert.ok(features.length > 0, 'devcontainer.json declares no features');
  const unpinned = features.filter((id) => !FEATURE_ID.test(id));
  assert.deepEqual(
    unpinned,
    [],
    `devcontainer features must name a registry and an exact x.y.z version, not a bare id or a floating tag:\n${unpinned.join('\n')}`,
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

// CI installs with `npm ci`, the only npm command that treats
// package-lock.json as an instruction: exact versions, integrity hashes
// verified, lockfile left alone. A bare `npm install` re-resolves the caret
// ranges in package.json against the registry, runs the lifecycle scripts of
// whatever it picked, and rewrites the lockfile in the contributor's tree — so
// a doc that prescribes it hands every contributor an unreviewed dependency
// graph and lets an upgrade ride into an unrelated PR. `npm install <pkg>` is
// still the right way to add a dependency, so only the bare form is rejected.
const BARE_NPM_INSTALL = /\bnpm install\s*(?=$|[\n`'"&|;])/;

test('no developer doc or devcontainer command prescribes a bare npm install', () => {
  const offenders = [];

  for (const doc of ['README.md', 'CONTRIBUTING.md', 'AGENTS.md']) {
    const lines = readFileSync(join(root, doc), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (BARE_NPM_INSTALL.test(line)) offenders.push(`${doc}:${index + 1}`);
    }
  }

  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  for (const key of [
    'initializeCommand',
    'onCreateCommand',
    'updateContentCommand',
    'postCreateCommand',
    'postStartCommand',
    'postAttachCommand',
  ]) {
    const value = devcontainer[key];
    const commands =
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? [value.join(' ')]
          : value && typeof value === 'object'
            ? Object.values(value).map((entry) => String(entry))
            : [];
    if (commands.some((command) => BARE_NPM_INSTALL.test(command)))
      offenders.push(`devcontainer.${key}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `these prescribe a bare \`npm install\`, which ignores package-lock.json; use \`npm ci\`: ${offenders.join(', ')}`,
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

// `just build` is the local stand-in for the CI gate: it runs the data
// validators and then the site build, which is exactly the sequence ci.yml
// runs before it will merge anything. The two lists are maintained by hand in
// two files that never reference each other, so a validator added to a
// workflow and not to the Justfile leaves `just build` green on a tree CI
// rejects — the failure a contributor only sees after pushing.
//
// The direction asserted is one-way on purpose. Every `validate:*` script a
// workflow runs must also be in the Justfile `build` recipe; the Justfile is
// free to run more than CI does (a stricter local gate is never the bug).
function workflowValidateTargets() {
  const dir = join(root, '.github/workflows');
  const found = new Map();
  for (const file of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const doc = parseYaml(readFileSync(join(dir, file), 'utf8'));
    for (const job of Object.values(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== 'string') continue;
        for (const target of npmRunTargets(step.run.split('\n'))) {
          if (!target.startsWith('validate:')) continue;
          if (!found.has(target)) found.set(target, file);
        }
      }
    }
  }
  return found;
}

test('the Justfile build recipe runs every validator a workflow runs', () => {
  const workflowTargets = workflowValidateTargets();
  assert.ok(
    workflowTargets.size > 0,
    'no workflow runs a validate:* script; update this test',
  );

  const buildBody = justRecipes.get('build');
  assert.ok(buildBody, 'Justfile declares no build recipe');
  const buildTargets = new Set(npmRunTargets(buildBody));

  const missing = [...workflowTargets]
    .filter(([target]) => !buildTargets.has(target))
    .map(([target, file]) => `${target} (run by ${file})`);

  assert.deepEqual(
    missing,
    [],
    `CI runs validators the Justfile build recipe does not, so 'just build' is a weaker gate than CI:\n${missing.join('\n')}`,
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

// `.github/actions/**` is the other place a Node major can live, and the walk
// above cannot see it: it reads `.github/workflows` and nothing else. A
// composite action that wraps `actions/setup-node` moves the pin out of every
// workflow that adopts it and into the action's own `inputs.node-version`
// default. The workflows that still carry a literal keep the
// `workflowVersions.length > 0` guard below satisfied, so the parity test goes
// on passing while the one declaration that decides the runtime sits in a file
// it never opens, and a bump that misses the devcontainer is green.
//
// The two shapes below are the ones a composite action can carry a major in:
// the input default, and a literal on a step. A `${{ inputs.node-version }}`
// step is skipped for the same reason the walk above skips
// `${{ env.NODE_VERSION }}` -- it resolves to the default, which is already
// recorded -- and an action that hard-codes a version on the step instead of
// declaring an input is caught by the second.
function actionNodeMajors(doc, file) {
  const found = [];
  const fallback = doc?.inputs?.['node-version']?.default;
  if (fallback !== undefined) found.push({ file, version: String(fallback) });
  for (const step of doc?.runs?.steps ?? []) {
    const version = step?.with?.['node-version'];
    if (version === undefined) continue;
    const literal = String(version);
    if (literal.includes('${{')) continue;
    found.push({ file, version: literal });
  }
  return found;
}

// Actions live one directory down by convention
// (`.github/actions/<name>/action.yml`) but nothing enforces that depth, so
// the walk recurses rather than assuming it. An absent `.github/actions` is
// the repository's current state, not an error.
function actionFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...actionFiles(path));
    else if (/^action\.ya?ml$/.test(entry.name)) found.push(path);
  }
  return found;
}

function compositeActionNodeMajors(dir = join(root, '.github/actions')) {
  return actionFiles(dir).flatMap((path) =>
    actionNodeMajors(
      parseYaml(readFileSync(path, 'utf8')),
      relative(root, path),
    ),
  );
}

function devcontainerNodeMajor() {
  const devcontainer = JSON.parse(stripJsonComments(devcontainerRaw));
  const features = devcontainer.features ?? {};
  const nodeKey = Object.keys(features).find((key) =>
    /(^|\/)node(:[\d.]+)?$/.test(key),
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
  const workflowVersions = [
    ...workflowNodeMajors(),
    ...compositeActionNodeMajors(),
  ];
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
    `workflows or composite actions pin a Node major the devcontainer does not (devcontainer: ${devcontainerMajor}): ${mismatched
      .map(({ file, version }) => `${file}=${version}`)
      .join(', ')}`,
  );
});

// The assertion above is a no-op until a composite action exists, and the
// repository has none yet, so the walk itself is pinned here against a
// fixture tree rather than against `.github/actions`. Each entry below is one
// shape the real directory can take: an action nested deeper than the
// `.github/actions/<name>/action.yml` convention, an action that declares the
// major as an input default only, one that hard-codes it on the step instead,
// a `${{ inputs.node-version }}` indirection that must not be double-counted,
// and a neighbouring file that is not an action manifest.
test('the composite-action walk finds every Node major a composite action pins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'endusers-actions-'));
  try {
    const write = (relativePath, contents) => {
      const path = join(dir, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    };

    write(
      'setup/action.yml',
      [
        'inputs:',
        '  node-version:',
        "    default: '22'",
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/setup-node@v7',
        '      with:',
        '        node-version: ${{ inputs.node-version }}',
        '',
      ].join('\n'),
    );
    write(
      'nested/deeper/action.yaml',
      [
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/setup-node@v7',
        '      with:',
        '        node-version: 24',
        '    - run: npm ci',
        '      shell: bash',
        '',
      ].join('\n'),
    );
    write('setup/README.md', 'not an action manifest\n');

    assert.deepEqual(
      compositeActionNodeMajors(dir).sort((a, b) =>
        a.file.localeCompare(b.file),
      ),
      [
        {
          file: relative(root, join(dir, 'nested/deeper/action.yaml')),
          version: '24',
        },
        { file: relative(root, join(dir, 'setup/action.yml')), version: '22' },
      ],
      'the walk must record the input default once and the step literal once, and skip the ${{ }} indirection and the non-manifest file',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// An absent directory is the repository's state today: the walk has to report
// nothing rather than throw, or the parity test fails on every tree that has
// not adopted a composite action yet.
test('the composite-action walk treats an absent .github/actions as empty', () => {
  assert.deepEqual(
    compositeActionNodeMajors(join(root, '.github/actions-does-not-exist')),
    [],
  );
});

// package.json's engines field is the only Node pin npm itself reads. The
// devcontainer, the workflows and CONTRIBUTING.md all have to be opened to be
// seen, so a contributor who clones outside the devcontainer gets no signal at
// all: `npm ci` endorses whatever major is installed. Pinning the field here
// puts it in the same parity chain as the two assertions above, so a Node bump
// that misses it fails the suite rather than leaving npm silently permissive.
test('package.json engines.node matches the pinned Node major', () => {
  const devcontainerMajor = devcontainerNodeMajor();
  const engines = packageJson.engines?.node;
  assert.ok(
    engines,
    'package.json declares no engines.node; npm has no Node pin to enforce',
  );
  const major = String(engines).match(/\d+/)?.[0];
  assert.equal(
    major,
    devcontainerMajor,
    `package.json engines.node (${engines}) pins a different Node major than the devcontainer (${devcontainerMajor})`,
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

// node_modules once entered the tree as a symlink to one developer's absolute
// path (#447). A tracked node_modules makes `npm ci` — the first documented
// setup step — mutate tracked state, so every contributor's tree is dirty
// before they have written a line. .gitignore alone cannot undo that: it never
// applies to paths git already tracks.
test('no node_modules path is tracked by git', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', 'node_modules', '*/node_modules'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(
    tracked,
    [],
    `git tracks dependency paths that npm ci overwrites: ${tracked.join(', ')}`,
  );
});

// A trailing slash only matches directories, so `node_modules/` lets a stray
// node_modules *symlink* be staged without a warning — exactly how #447
// happened. The slashless rule matches both shapes.
test('.gitignore ignores node_modules as a file as well as a directory', () => {
  const rules = readFileSync(join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim());
  assert.ok(
    rules.includes('node_modules'),
    '.gitignore must list node_modules without a trailing slash so a symlink is ignored too',
  );
  const status = execFileSync('git', ['check-ignore', '-q', 'node_modules'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.equal(status, '');
});

// .vscode/settings.json is the third entry point a contributor meets before CI
// does, and the only one nothing read until now. It once described a Hugo site
// using the Docsy theme — `themes/docsy`, `vendor`, `resources`, `.docker/` —
// none of which this Docusaurus repo has, while every directory the repo does
// generate was searched and watched. Both halves of that drift are silent:
// VS Code ignores an exclude whose path is absent, and never reports one that
// is missing.
const vscodeSettings = JSON.parse(
  stripJsonComments(readFileSync(join(root, '.vscode/settings.json'), 'utf8')),
);

const EXCLUDE_MAPS = [
  'files.exclude',
  'files.watcherExclude',
  'search.exclude',
];

// Directories the repo's own commands write, each ignored by .gitignore:
// `build/` and `.docusaurus` from the docusaurus build, `coverage` from
// test:unit:coverage, `test-results`/`playwright-report` from test:e2e.
const GENERATED_DIRS = [
  'build',
  '.docusaurus',
  'coverage',
  'test-results',
  'playwright-report',
];

// A VS Code exclude key is a glob. Only keys that name one literal path can be
// checked against the checkout; `**/.DS_Store` and friends address no single
// location. A leading `**/` is stripped because it means "at any depth",
// which includes the root.
function literalExcludePath(key) {
  const trimmed = key.replace(/^\*\*\//, '').replace(/\/$/, '');
  if (trimmed === '' || /[*?{}[\]!]/.test(trimmed)) return null;
  return trimmed;
}

// git check-ignore matches a rule against the pathname it is handed, without
// stat()ing it, so the shape of the pathname decides which rules can match.
// .gitignore:10 is `/build/`, and a directory-only rule never matches the bare
// pathname `build`; a file rule such as `.DS_Store` never matches `.DS_Store/`.
// Both shapes are probed so either kind of rule counts.
function gitIgnores(path) {
  return [path, `${path}/`].some((candidate) => {
    try {
      execFileSync('git', ['check-ignore', '-q', candidate], {
        cwd: root,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  });
}

function excludeEntries(mapName) {
  const map = vscodeSettings[mapName];
  assert.ok(
    map && typeof map === 'object',
    `.vscode/settings.json declares no ${mapName}`,
  );
  return map;
}

test('every path .vscode/settings.json excludes exists or is gitignored', () => {
  const fiction = [];
  for (const mapName of EXCLUDE_MAPS) {
    for (const key of Object.keys(excludeEntries(mapName))) {
      const path = literalExcludePath(key);
      if (path === null) continue;
      if (existsSync(join(root, path))) continue;
      if (gitIgnores(path)) continue;
      fiction.push(`${mapName}["${key}"]`);
    }
  }
  assert.deepEqual(
    fiction,
    [],
    `.vscode/settings.json excludes paths this repo neither contains nor generates: ${fiction.join(', ')}`,
  );
});

// Searching the build output is not a cosmetic annoyance: it buries every real
// hit under the bundled copy of the same source, and the watcher walking it
// costs a file handle per generated file.
test('.vscode/settings.json excludes every directory the repo generates', () => {
  const missing = [];
  for (const mapName of ['search.exclude', 'files.watcherExclude']) {
    const map = excludeEntries(mapName);
    for (const dir of GENERATED_DIRS) {
      if (map[dir] === true) continue;
      if (map[`**/${dir}`] === true) continue;
      missing.push(`${mapName} omits ${dir}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `generated directories are searched and watched: ${missing.join(', ')}`,
  );
});

// Every directory this test requires excluded has to be one git already
// ignores, or the rule above would be asking contributors to hide tracked
// files from themselves.
test('every directory required to be excluded is gitignored', () => {
  const tracked = GENERATED_DIRS.filter((dir) => !gitIgnores(dir));
  assert.deepEqual(
    tracked,
    [],
    `.gitignore no longer ignores directories .vscode/settings.json hides: ${tracked.join(', ')}`,
  );
});

// files.exclude hides entries from the explorer outright. Hiding .vscode hides
// this very file, which is how it stayed wrong: a contributor cannot fix
// configuration they cannot see.
test('files.exclude does not hide .vscode from the explorer', () => {
  const hidden = Object.entries(excludeEntries('files.exclude'))
    .filter(
      ([key, value]) => value === true && literalExcludePath(key) === '.vscode',
    )
    .map(([key]) => key);
  assert.deepEqual(
    hidden,
    [],
    `files.exclude hides the editor settings it is written in: ${hidden.join(', ')}`,
  );
});
