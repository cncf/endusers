import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = 'generate-members.mjs';
const repoRoot = new URL('..', import.meta.url).pathname;

// generate-members.mjs reads its inputs and writes data/members.json relative to
// its own location, so the shared runScriptWithFixtures helper — which deletes
// the temp directory before returning — cannot expose the generated file. This
// runner mirrors the same layout and returns the parsed output as well.
function generateMembers(fixtureFiles) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-members-test-'));
  try {
    mkdirSync(join(work, 'scripts'), { recursive: true });
    cpSync(join(repoRoot, 'scripts', SCRIPT), join(work, 'scripts', SCRIPT));
    cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
      recursive: true,
    });
    for (const [relativePath, content] of Object.entries(fixtureFiles)) {
      const target = join(work, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const result = spawnSync('node', [join(work, 'scripts', SCRIPT)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const status = result.status ?? 1;
    return {
      status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      output:
        status === 0
          ? JSON.parse(readFileSync(join(work, 'data/members.json'), 'utf8'))
          : null,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function fixtures({ catalog = [], awards = [] } = {}) {
  return {
    'data/architectures/catalog.json': JSON.stringify(catalog),
    'data/awards.json': JSON.stringify({ awards }),
  };
}

function run(options) {
  const result = generateMembers(fixtures(options));
  assert.equal(result.status, 0, `script failed: ${result.stderr}`);
  return result;
}

function ids(result) {
  return result.output.members.map((member) => member.id);
}

function memberById(result, id) {
  const member = result.output.members.find((entry) => entry.id === id);
  assert.ok(member, `no member "${id}" in ${JSON.stringify(ids(result))}`);
  return member;
}

function catalogEntry(overrides = {}) {
  return {
    id: 'acme-platform',
    title: 'Acme platform architecture',
    organization: 'Acme',
    industries: ['Software'],
    projects: ['Kubernetes'],
    sourceUrl: 'https://example.test/architectures/acme',
    sourceCommit: 'abc123',
    assets: [],
    ...overrides,
  };
}

function awardEntry(overrides = {}) {
  return {
    year: 2024,
    slug: 'acme',
    award: 'top-end-user',
    awardLabel: 'Top End User Award',
    organization: 'Acme Corporation',
    citation: 'For outstanding adoption of cloud native.',
    event: 'KubeCon NA 2024',
    logo: '/img/awards/acme.svg',
    ...overrides,
  };
}

test('emits the documented envelope around the member list', () => {
  const result = run({ catalog: [catalogEntry()] });

  assert.deepEqual(result.output.generatedFrom, [
    'data/architectures/catalog.json',
    'data/awards.json',
  ]);
  assert.match(
    result.output.description,
    /CNCF End User Community member organisations/,
  );
  assert.deepEqual(Object.keys(result.output.schema).sort(), [
    'architectures',
    'awards',
    'id',
    'industries',
    'logo',
    'name',
    'projects',
    'slug',
    'sourceAttribution',
  ]);
  assert.match(result.stdout, /Generated 1 member entries\./);
});

test('produces an empty member list when both sources are empty', () => {
  const result = run({});

  assert.deepEqual(result.output.members, []);
  assert.match(result.stdout, /Generated 0 member entries\./);
});

test('derives a slug by stripping legal suffixes, parentheticals and punctuation', () => {
  const result = run({
    catalog: [
      catalogEntry({ organization: 'Acme Ltd.' }),
      catalogEntry({ organization: 'Globex Software GmbH' }),
      catalogEntry({ organization: 'Initech (Germany) AG' }),
      catalogEntry({ organization: "Hooli's Cloud, Inc." }),
    ],
  });

  assert.deepEqual(ids(result), [
    'acme',
    'globex-software',
    'hoolis-cloud',
    'initech',
  ]);
});

test('applies SLUG_OVERRIDES for organisations that normalise incorrectly', () => {
  const result = run({
    catalog: [
      catalogEntry({ organization: 'Flipkart Internet Pvt. Ltd.' }),
      catalogEntry({ organization: 'Swisscom (Switzerland) Ltd' }),
    ],
  });

  assert.deepEqual(ids(result), ['flipkart', 'swisscom']);
});

test('applies DISPLAY_NAME_OVERRIDES to the derived display name', () => {
  const result = run({
    catalog: [
      catalogEntry({ organization: 'Mercedes-Benz Tech Innovation' }),
      catalogEntry({ organization: 'Allianz Direct' }),
    ],
  });

  assert.equal(memberById(result, 'allianz').name, 'Allianz');
  assert.equal(
    result.output.members.find((member) => member.name === 'Mercedes-Benz'),
    result.output.members.find((member) => member.id !== 'allianz'),
  );
});

test('prefers the award organisation name over the catalog organisation name', () => {
  const result = run({
    catalog: [catalogEntry({ organization: 'Acme' })],
    awards: [awardEntry({ slug: 'acme', organization: 'Acme Corporation' })],
  });

  assert.equal(result.output.members.length, 1);
  assert.equal(memberById(result, 'acme').name, 'Acme Corporation');
});

test('falls back to the slug when no organisation name is present', () => {
  const result = run({
    awards: [awardEntry({ slug: 'acme', organization: undefined })],
  });

  assert.equal(memberById(result, 'acme').name, 'acme');
});

test('ignores award entries that have no slug', () => {
  const result = run({
    awards: [awardEntry({ slug: undefined }), awardEntry({ slug: 'globex' })],
  });

  assert.deepEqual(ids(result), ['globex']);
});

test('merges catalog and award entries that share a slug', () => {
  const result = run({
    catalog: [
      catalogEntry({
        id: 'acme-one',
        title: 'One',
        industries: ['Retail'],
        projects: ['Helm'],
      }),
      catalogEntry({
        id: 'acme-two',
        title: 'Two',
        industries: ['Software', 'Retail'],
        projects: ['Kubernetes', 'Helm'],
      }),
    ],
    awards: [awardEntry({ year: 2023 }), awardEntry({ year: 2024 })],
  });

  const member = memberById(result, 'acme');
  assert.equal(result.output.members.length, 1);
  assert.deepEqual(member.industries, ['Retail', 'Software']);
  assert.deepEqual(member.projects, ['Helm', 'Kubernetes']);
  assert.deepEqual(
    member.architectures.map((architecture) => architecture.id),
    ['acme-one', 'acme-two'],
  );
  assert.deepEqual(
    member.awards.map((award) => award.year),
    [2023, 2024],
  );
});

test('tolerates catalog entries without industries, projects or assets', () => {
  const result = run({
    catalog: [
      catalogEntry({
        industries: undefined,
        projects: undefined,
        assets: undefined,
      }),
    ],
  });

  const member = memberById(result, 'acme');
  assert.deepEqual(member.industries, []);
  assert.deepEqual(member.projects, []);
  assert.equal(member.logo, null);
});

test('sorts members by slug', () => {
  const result = run({
    catalog: [
      catalogEntry({ organization: 'Zeta' }),
      catalogEntry({ organization: 'Acme' }),
      catalogEntry({ organization: 'Mercury' }),
    ],
  });

  assert.deepEqual(ids(result), ['acme', 'mercury', 'zeta']);
});

test('projects only the documented architecture and award fields', () => {
  const result = run({
    catalog: [catalogEntry({ summary: 'dropped', tags: ['dropped'] })],
    awards: [awardEntry()],
  });

  const member = memberById(result, 'acme');
  assert.deepEqual(Object.keys(member.architectures[0]).sort(), [
    'id',
    'sourceCommit',
    'sourceUrl',
    'title',
  ]);
  assert.deepEqual(Object.keys(member.awards[0]).sort(), [
    'announcementUrl',
    'award',
    'awardLabel',
    'caseStudyUrl',
    'citation',
    'event',
    'talkUrl',
    'year',
  ]);
  assert.equal(member.awards[0].announcementUrl, null);
  assert.equal(member.awards[0].caseStudyUrl, null);
  assert.equal(member.awards[0].talkUrl, null);
});

test('collects source attribution from catalog and award URLs, skipping nulls', () => {
  const result = run({
    catalog: [catalogEntry({ sourceUrl: 'https://example.test/architecture' })],
    awards: [
      awardEntry({
        announcementUrl: 'https://example.test/announcement',
        caseStudyUrl: null,
      }),
      awardEntry({
        year: 2025,
        announcementUrl: null,
        caseStudyUrl: 'https://example.test/case-study',
      }),
    ],
  });

  assert.deepEqual(memberById(result, 'acme').sourceAttribution, [
    'https://example.test/architecture',
    'https://example.test/announcement',
    'https://example.test/case-study',
  ]);
});

test('picks an asset named logo ahead of every other candidate', () => {
  const result = run({
    catalog: [
      catalogEntry({
        assets: [
          '/img/architectures/acme/acme.svg',
          '/img/architectures/acme/logo.png',
        ],
      }),
    ],
    awards: [awardEntry()],
  });

  assert.equal(
    memberById(result, 'acme').logo,
    '/img/architectures/acme/logo.png',
  );
});

test('picks the asset whose filename matches the slug when there is no logo asset', () => {
  const result = run({
    catalog: [
      catalogEntry({
        assets: [
          '/img/architectures/acme/diagram.svg',
          '/img/architectures/acme/acme.png',
        ],
      }),
    ],
  });

  assert.equal(
    memberById(result, 'acme').logo,
    '/img/architectures/acme/acme.png',
  );
});

test('prefers the shortest-named SVG over a PNG when no name matches', () => {
  const result = run({
    catalog: [
      catalogEntry({
        assets: [
          '/img/architectures/acme/overall-platform-architecture.svg',
          '/img/architectures/acme/mark.svg',
          '/img/architectures/acme/screenshot.png',
        ],
      }),
    ],
  });

  assert.equal(
    memberById(result, 'acme').logo,
    '/img/architectures/acme/mark.svg',
  );
});

test('falls back to a PNG when no SVG asset exists', () => {
  const result = run({
    catalog: [
      catalogEntry({
        assets: [
          '/img/architectures/acme/diagram.webp',
          '/img/architectures/acme/diagram.png',
        ],
      }),
    ],
  });

  assert.equal(
    memberById(result, 'acme').logo,
    '/img/architectures/acme/diagram.png',
  );
});

test('falls back to the award logo when no usable catalog asset exists', () => {
  const result = run({
    catalog: [
      catalogEntry({ assets: ['/img/architectures/acme/diagram.webp'] }),
    ],
    awards: [awardEntry({ logo: '/img/awards/acme.svg' })],
  });

  assert.equal(memberById(result, 'acme').logo, '/img/awards/acme.svg');
});

test('emits a null logo for an award-only member with no award logo', () => {
  const result = run({ awards: [awardEntry({ logo: null })] });

  const member = memberById(result, 'acme');
  assert.equal(member.logo, null);
  assert.deepEqual(member.architectures, []);
});

test('considers assets from every catalog entry of the same member', () => {
  const result = run({
    catalog: [
      catalogEntry({
        id: 'acme-one',
        assets: ['/img/architectures/acme/diagram.webp'],
      }),
      catalogEntry({
        id: 'acme-two',
        assets: ['/img/architectures/acme/logo.svg'],
      }),
    ],
  });

  assert.equal(
    memberById(result, 'acme').logo,
    '/img/architectures/acme/logo.svg',
  );
});

test('generates members from the current repository data', () => {
  const result = generateMembers({
    'data/architectures/catalog.json': readFileSync(
      join(repoRoot, 'data/architectures/catalog.json'),
      'utf8',
    ),
    'data/awards.json': readFileSync(
      join(repoRoot, 'data/awards.json'),
      'utf8',
    ),
  });

  assert.equal(result.status, 0, `script failed: ${result.stderr}`);
  assert.ok(result.output.members.length > 0);
  for (const member of result.output.members) {
    assert.equal(member.id, member.slug);
    assert.match(member.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(member.name.length > 0);
    assert.ok(Array.isArray(member.industries));
    assert.ok(Array.isArray(member.projects));
    assert.ok(member.architectures.length > 0 || member.awards.length > 0);
  }
});

// scripts/import-architectures.mjs copies `organization` from the `org_name`
// frontmatter of the cncf/architecture clone, so the override maps and slug
// indexes are keyed by upstream-controlled strings. Before #564 an
// organisation named after an Object.prototype member inherited that member as
// its slug and lost its name entirely (a function-valued property that
// JSON.stringify drops), publishing a nameless member card.
for (const hostileName of [
  'toString',
  'constructor',
  '__proto__',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
]) {
  test(`slugs an organisation named "${hostileName}" without inheriting from Object.prototype`, () => {
    const result = run({
      catalog: [
        catalogEntry({ id: 'hostile-arch', organization: hostileName }),
      ],
    });

    assert.equal(result.output.members.length, 1);
    const [member] = result.output.members;
    assert.equal(typeof member.slug, 'string');
    assert.equal(member.id, member.slug);
    assert.match(member.slug, /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/);
    assert.equal(member.slug, hostileName.toLowerCase());
    assert.equal(member.name, hostileName);
    assert.equal(member.architectures.length, 1);
    assert.equal(member.architectures[0].id, 'hostile-arch');
  });
}

test('keeps an award slugged after an Object.prototype member out of the prototype chain', () => {
  const result = run({
    awards: [awardEntry({ slug: 'constructor', organization: 'Constructor' })],
  });

  assert.equal(result.output.members.length, 1);
  const [member] = result.output.members;
  assert.equal(member.id, 'constructor');
  assert.equal(member.name, 'Constructor');
  assert.equal(member.awards.length, 1);
  assert.equal(member.awards[0].year, 2024);
});
