import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { validateAwards } from '../scripts/lib/validate-awards.mjs';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-awards.mjs';

const validEntry = {
  year: 2024,
  slug: 'acme',
  award: 'Top End User Award',
  awardLabel: 'Winner',
  organization: 'Acme Corp',
  citation: 'For outstanding adoption of cloud native.',
  event: 'KubeCon NA 2024',
  announcementUrl: 'https://www.cncf.io/announcements/2024/example',
};

function awardsFixture(awards, overrides = {}) {
  return {
    'data/awards.json': JSON.stringify({
      verifiedAt: '2026-08-08',
      verifiedAgainst: 'https://contribute.cncf.io/community/awards/',
      awards,
      ...overrides,
    }),
  };
}

function validateFixture(fixtures) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-awards-core-'));
  try {
    for (const [path, content] of Object.entries(fixtures)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return validateAwards(
      JSON.parse(fixtures['data/awards.json']),
      join(root, 'static'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertError(errors, message) {
  assert.ok(
    errors.some(
      (error) => error.severity === 'error' && message.test(error.message),
    ),
    JSON.stringify(errors),
  );
}

test('accepts a valid awards file', () => {
  assert.deepEqual(validateFixture(awardsFixture([validEntry])), []);
});

test('rejects an empty awards array', () => {
  assert.deepEqual(validateFixture(awardsFixture([])), [
    {
      path: 'awards.json',
      severity: 'error',
      message: 'awards must be a non-empty array',
    },
  ]);
});

test('rejects a truthy non-array awards without crashing', () => {
  assert.deepEqual(validateFixture(awardsFixture({ 1: validEntry })), [
    {
      path: 'awards.json',
      severity: 'error',
      message: 'awards must be a non-empty array',
    },
  ]);
});

test('rejects a missing verifiedAt', () => {
  assert.deepEqual(
    validateFixture(awardsFixture([validEntry], { verifiedAt: undefined })),
    [
      {
        path: 'awards.json',
        severity: 'error',
        message:
          'verifiedAt must be a parseable date recording the last completeness audit against verifiedAgainst',
      },
    ],
  );
});

test('rejects a missing verifiedAgainst', () => {
  assert.deepEqual(
    validateFixture(
      awardsFixture([validEntry], { verifiedAgainst: undefined }),
    ),
    [
      {
        path: 'awards.json',
        severity: 'error',
        message:
          'verifiedAgainst must be an https URL to the canonical award history source',
      },
    ],
  );
});

test('rejects a non-https verifiedAgainst', () => {
  assert.deepEqual(
    validateFixture(
      awardsFixture([validEntry], {
        verifiedAgainst: 'contribute.cncf.io/community/awards/',
      }),
    ),
    [
      {
        path: 'awards.json',
        severity: 'error',
        message: 'verifiedAgainst must be an absolute https URL',
      },
    ],
  );
});

test('rejects years before 2015', () => {
  assert.deepEqual(
    validateFixture(awardsFixture([{ ...validEntry, year: 2014 }])),
    [{ path: '2014/acme', severity: 'error', message: 'invalid year' }],
  );
});

test('accepts the first supported award year', () => {
  assert.deepEqual(
    validateFixture(awardsFixture([{ ...validEntry, year: 2015 }])),
    [],
  );
});

test('rejects entries sorted oldest first', () => {
  const older = { ...validEntry, year: 2022, slug: 'older' };
  const newer = { ...validEntry, year: 2023, slug: 'newer' };
  assertError(validateFixture(awardsFixture([older, newer])), /newest first/);
});

test('accepts entries sorted newest first', () => {
  const newer = { ...validEntry, year: 2024, slug: 'newer' };
  const older = { ...validEntry, year: 2023, slug: 'older' };
  assert.deepEqual(validateFixture(awardsFixture([newer, older])), []);
});

test('accepts multiple awards in the same year', () => {
  assert.deepEqual(
    validateFixture(
      awardsFixture([validEntry, { ...validEntry, slug: 'second' }]),
    ),
    [],
  );
});

for (const [logo, file] of [
  ['/img/awards/../outside.svg', 'static/img/outside.svg'],
  ['//img/awards/acme.svg', 'static/img/awards/acme.svg'],
]) {
  test(`rejects a logo outside the allowed URL/path boundary: ${logo}`, () => {
    assertError(
      validateFixture({
        ...awardsFixture([{ ...validEntry, logo }]),
        [file]: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      }),
      /logo must live under \/img\/awards\//,
    );
  });
}

test('rejects missing required fields', () => {
  const { citation, ...withoutCitation } = validEntry;
  assertError(
    validateFixture(awardsFixture([withoutCitation])),
    /missing citation/,
  );
});

test('rejects non-https URLs', () => {
  assertError(
    validateFixture(
      awardsFixture([
        { ...validEntry, announcementUrl: 'http://example.com/award' },
      ]),
    ),
    /announcementUrl must use https, got http:/,
  );
});

// The visible prefix of a userinfo URL disagrees with its real authority.
test('rejects a link field carrying a userinfo component', () => {
  const errors = validateFixture(
    awardsFixture([
      {
        ...validEntry,
        announcementUrl: 'https://www.cncf.io@evil.example/phish',
      },
    ]),
  );
  assertError(errors, /announcementUrl must not carry a userinfo/);
  assertError(errors, /evil\.example/);
});

test('rejects a verifiedAgainst carrying a userinfo component', () => {
  assertError(
    validateFixture(
      awardsFixture([validEntry], {
        verifiedAgainst: 'https://contribute.cncf.io@evil.example/awards/',
      }),
    ),
    /verifiedAgainst must not carry a userinfo/,
  );
});

test('rejects an unparseable value that still begins with https://', () => {
  for (const announcementUrl of ['https://', 'https:// evil.example']) {
    assertError(
      validateFixture(awardsFixture([{ ...validEntry, announcementUrl }])),
      /announcementUrl must be an absolute https URL/,
    );
  }
});

test('rejects a javascript: URL in an optional link field', () => {
  assertError(
    validateFixture(
      awardsFixture([
        { ...validEntry, caseStudyUrl: 'javascript:alert(document.domain)' },
      ]),
    ),
    /caseStudyUrl must use https, got javascript:/,
  );
});

test('rejects a link field whose host is outside the allow-list', () => {
  for (const [field, url] of [
    ['announcementUrl', 'https://www.cncf.io.evil.example/announcements/x'],
    ['caseStudyUrl', 'https://evil.example/case-studies/acme'],
    ['talkUrl', 'https://vimeo.example/9'],
  ]) {
    assertError(
      validateFixture(awardsFixture([{ ...validEntry, [field]: url }])),
      new RegExp(`${field} must be on `),
    );
  }
});

test('accepts link fields on cncf.io subdomains and a YouTube talk', () => {
  assert.deepEqual(
    validateFixture(
      awardsFixture([
        {
          ...validEntry,
          caseStudyUrl: 'https://www.cncf.io/case-studies/acme/',
          talkUrl: 'https://youtu.be/9GIQyQjs36o',
        },
      ]),
    ),
    [],
  );
});

test('rejects a verifiedAgainst outside the CNCF hosts', () => {
  assertError(
    validateFixture(
      awardsFixture([validEntry], {
        verifiedAgainst: 'https://evil.example/community/awards/',
      }),
    ),
    /verifiedAgainst/,
  );
});

test('rejects entries with neither announcementUrl nor talkUrl', () => {
  const { announcementUrl, ...withoutUrl } = validEntry;
  assertError(
    validateFixture(awardsFixture([withoutUrl])),
    /announcementUrl or talkUrl/,
  );
});

test('accepts a talkUrl in place of an announcementUrl', () => {
  const { announcementUrl, ...rest } = validEntry;
  assert.deepEqual(
    validateFixture(
      awardsFixture([
        { ...rest, talkUrl: 'https://www.youtube.com/watch?v=1' },
      ]),
    ),
    [],
  );
});

test('rejects logos outside /img/awards/', () => {
  assertError(
    validateFixture(
      awardsFixture([{ ...validEntry, logo: '/img/other/logo.svg' }]),
    ),
    /\/img\/awards\//,
  );
});

test('rejects a logo that escapes /img/awards/ with .. segments', () => {
  const errors = validateFixture(
    awardsFixture([
      { ...validEntry, logo: '/img/awards/../../../../../etc/hostname' },
    ]),
  );
  assertError(errors, /logo must live under \/img\/awards\//);
  assert.ok(errors.every((error) => !/logo file missing/.test(error.message)));
});

test('rejects a logo that escapes static/ entirely via .. segments', () => {
  assertError(
    validateFixture(
      awardsFixture([
        { ...validEntry, logo: '/img/awards/../../package.json' },
      ]),
    ),
    /logo must live under \/img\/awards\//,
  );
});

test('rejects a non-string logo without crashing', () => {
  assertError(
    validateFixture(awardsFixture([{ ...validEntry, logo: 42 }])),
    /logo must be a string path/,
  );
});

test('rejects logo files missing from static/', () => {
  assertError(
    validateFixture(
      awardsFixture([{ ...validEntry, logo: '/img/awards/missing.svg' }]),
    ),
    /logo file missing/,
  );
});

test('accepts a logo that exists under static/img/awards/', () => {
  assert.deepEqual(
    validateFixture({
      ...awardsFixture([{ ...validEntry, logo: '/img/awards/acme.svg' }]),
      'static/img/awards/acme.svg':
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    }),
    [],
  );
});

test('the CLI resolves input and logo fixtures and preserves its success output', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...awardsFixture([{ ...validEntry, logo: '/img/awards/acme.svg' }]),
    'static/img/awards/acme.svg':
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Validated 1 award entries\n');
  assert.equal(result.stderr, '');
});

test('the CLI preserves validation diagnostics and failure exit status', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    awardsFixture([{ ...validEntry, year: 2014 }]),
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    '\n1 error(s) in awards:\n  [error] 2014/acme: invalid year\n',
  );
});

test('the CLI reports unreadable input rather than a validation success', () => {
  const result = runScriptWithFixtures(SCRIPT);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ENOENT/);
});

test('the CLI reports malformed JSON rather than a validation success', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'data/awards.json': '{ invalid',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /SyntaxError/);
});
