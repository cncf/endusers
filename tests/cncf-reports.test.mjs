// Behavioural contract of scripts/lib/cncf-reports.mjs, the collector and
// validator shared by the Radar and Survey report mirrors, driven in-process
// against a stubbed global fetch and a temporary repository root.
//
// tests/collect-*-reports.test.mjs and tests/validate-*-reports.test.mjs run
// the thin entry points in a sandboxed child process, which no in-process
// coverage (unit or mutation) can see. These tests pin what the shared module
// does: which cncf.io endpoints it asks for, how it shapes and orders the
// reports, when it leaves the data file untouched, and what the validator
// accepts and rejects.
import assert from 'node:assert/strict';
import fs, {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  RADAR_REPORTS,
  SURVEY_REPORTS,
  collectReports,
  validateReports,
} from '../scripts/lib/cncf-reports.mjs';

const API = 'https://www.cncf.io/wp-json/wp/v2';
const PLACEHOLDER = 'Summary needed — see the report for details.';

const TERMS = [
  { id: 1609, slug: 'radar', name: 'Radar' },
  { id: 1208, slug: 'survey', name: 'Survey' },
];

function post(id, slug, date, title = slug) {
  return {
    id,
    slug,
    link: `https://www.cncf.io/reports/${slug}/`,
    title: { rendered: title },
    date,
  };
}

// Replaces globalThis.fetch with a stub that answers the term listing and the
// report listing by URL substring and records every request. Each response
// is a single page unless `totalPages` says otherwise.
async function withApi({ terms = TERMS, posts = [] }, fn) {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    const body = url.includes('/lf-report-type?')
      ? terms
      : url.includes('/lf_report?')
        ? posts
        : null;
    if (!body) throw new Error(`unexpected request: ${url}`);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body,
    };
  };
  try {
    return await fn(requested);
  } finally {
    globalThis.fetch = original;
  }
}

async function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'cncf-reports-'));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeData(root, type, data) {
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', type.file), JSON.stringify(data));
}

function readData(root, type) {
  return JSON.parse(readFileSync(join(root, 'data', type.file), 'utf8'));
}

// Captures console.log lines emitted while fn runs.
async function withLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    return await fn(lines);
  } finally {
    console.log = original;
  }
}

// reportAndExit writes to stderr's descriptor and may call process.exit(1);
// capture both so a failing validation is observable without ending the run.
function withCapturedExit(fn) {
  const originalWriteSync = fs.writeSync;
  const originalExit = process.exit;
  const stderr = [];
  const exitCodes = [];
  fs.writeSync = (fd, buffer, offset) => {
    stderr.push(buffer.subarray(offset).toString('utf8'));
    return buffer.length - offset;
  };
  process.exit = (code) => exitCodes.push(code);
  try {
    fn();
  } finally {
    fs.writeSync = originalWriteSync;
    process.exit = originalExit;
  }
  return { stderr: stderr.join(''), exitCodes };
}

test('the two report types differ only in the term they mirror and the file they feed', () => {
  assert.deepEqual(RADAR_REPORTS, {
    slug: 'radar',
    name: 'Radar',
    noun: 'radar report',
    key: 'radarReports',
    file: 'radar-reports.json',
    route: '/resources/radar-reports',
    collector: 'scripts/collect-radar-reports.mjs',
  });
  assert.deepEqual(SURVEY_REPORTS, {
    slug: 'survey',
    name: 'Survey',
    noun: 'survey report',
    key: 'surveyReports',
    file: 'survey-reports.json',
    route: '/resources/surveys',
    collector: 'scripts/collect-survey-reports.mjs',
  });
});

test('collectReports resolves the term by slug, lists its reports and writes the data file', async () => {
  await withTempRoot(async (root) => {
    const posts = [
      post(1, 'older-survey', '2023-01-05T10:00:00', 'Older &amp; Survey'),
      post(2, 'newer-survey', '2024-06-01T10:00:00'),
    ];
    const lines = await withLog(async (log) => {
      await withApi({ posts }, async (requested) => {
        await collectReports(SURVEY_REPORTS, { root });
        assert.deepEqual(requested, [
          `${API}/lf-report-type?per_page=100&page=1`,
          `${API}/lf_report?lf-report-type=1208&_fields=id,slug,link,title,date&per_page=100&page=1`,
        ]);
      });
      return log;
    });

    const data = readData(root, SURVEY_REPORTS);
    assert.equal(data.source, 'cncf.io reports (Survey type)');
    assert.equal(
      data.sourceUrl,
      'https://www.cncf.io/reports?_sft_lf-report-type=survey',
    );
    assert.equal(data.apiUrl, `${API}/lf_report?lf-report-type=1208`);
    assert.match(
      data.description,
      /^CNCF Survey reports mirrored from cncf\.io for \/resources\/surveys\. Regenerated by scripts\/collect-survey-reports\.mjs via the refresh-radar-reports workflow \(daily\)\./,
    );
    assert.match(data.description, /`summary` is hand-written/);
    assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
    assert.deepEqual(data.surveyReports, [
      {
        id: 2,
        title: 'newer-survey',
        slug: 'newer-survey',
        url: 'https://www.cncf.io/reports/newer-survey/',
        publishedAt: '2024-06-01',
        summary: PLACEHOLDER,
      },
      {
        id: 1,
        title: 'Older & Survey',
        slug: 'older-survey',
        url: 'https://www.cncf.io/reports/older-survey/',
        publishedAt: '2023-01-05',
        summary: PLACEHOLDER,
      },
    ]);
    assert.deepEqual(lines, [
      `Collected 2 survey reports at ${data.generatedAt}`,
    ]);
    assert.equal(
      readFileSync(join(root, 'data', SURVEY_REPORTS.file), 'utf8').endsWith(
        '}\n',
      ),
      true,
      'the file is pretty-printed with a trailing newline',
    );
  });
});

test('collectReports keys the radar mirror off the radar term', async () => {
  await withTempRoot(async (root) => {
    await withLog(() =>
      withApi(
        { posts: [post(9, 'radar-x', '2022-02-02T00:00:00')] },
        async (requested) => {
          await collectReports(RADAR_REPORTS, { root });
          assert.match(requested[1], /lf-report-type=1609&/);
        },
      ),
    );
    const data = readData(root, RADAR_REPORTS);
    assert.equal(data.source, 'cncf.io reports (Radar type)');
    assert.equal(data.radarReports.length, 1);
    assert.equal('surveyReports' in data, false);
  });
});

test('collectReports falls back to the slug for an empty title and null for a missing date', async () => {
  await withTempRoot(async (root) => {
    const posts = [
      {
        id: 1,
        slug: 'untitled',
        link: 'https://www.cncf.io/reports/untitled/',
      },
      {
        id: 2,
        slug: 'blank',
        link: 'https://www.cncf.io/reports/blank/',
        title: { rendered: '   ' },
        date: '2021-01-01T00:00:00',
      },
      {
        id: 3,
        slug: 'unrendered',
        link: 'https://www.cncf.io/reports/unrendered/',
        title: {},
        date: '2022-01-01T00:00:00',
      },
    ];
    await withLog(() =>
      withApi({ posts }, () => collectReports(SURVEY_REPORTS, { root })),
    );
    const reports = readData(root, SURVEY_REPORTS).surveyReports;
    assert.deepEqual(
      reports.map(({ id, title, publishedAt }) => ({ id, title, publishedAt })),
      [
        { id: 3, title: 'unrendered', publishedAt: '2022-01-01' },
        { id: 2, title: 'blank', publishedAt: '2021-01-01' },
        { id: 1, title: 'untitled', publishedAt: null },
      ],
    );
  });
});

test('collectReports preserves hand-written summaries by id and placeholders the rest', async () => {
  await withTempRoot(async (root) => {
    writeData(root, SURVEY_REPORTS, {
      surveyReports: [
        { id: 1, summary: 'Kept from the last refresh.' },
        { id: 2, summary: '' },
      ],
    });
    const posts = [
      post(1, 'one', '2024-01-01T00:00:00'),
      post(2, 'two', '2024-01-02T00:00:00'),
      post(3, 'three', '2024-01-03T00:00:00'),
    ];
    await withLog(() =>
      withApi({ posts }, () => collectReports(SURVEY_REPORTS, { root })),
    );
    const reports = readData(root, SURVEY_REPORTS).surveyReports;
    assert.deepEqual(
      reports.map(({ id, summary }) => ({ id, summary })),
      [
        { id: 3, summary: PLACEHOLDER },
        { id: 2, summary: PLACEHOLDER },
        { id: 1, summary: 'Kept from the last refresh.' },
      ],
    );
  });
});

test('collectReports tolerates an existing file without the report array', async () => {
  await withTempRoot(async (root) => {
    writeData(root, SURVEY_REPORTS, {
      generatedAt: '2020-01-01T00:00:00.000Z',
    });
    await withLog(() =>
      withApi({ posts: [post(1, 'one', '2024-01-01T00:00:00')] }, () =>
        collectReports(SURVEY_REPORTS, { root }),
      ),
    );
    assert.equal(readData(root, SURVEY_REPORTS).surveyReports.length, 1);
  });
});

test('collectReports leaves the file untouched when the reports did not change', async () => {
  await withTempRoot(async (root) => {
    const posts = [post(1, 'one', '2024-01-01T00:00:00')];
    await withLog(() =>
      withApi({ posts }, () => collectReports(SURVEY_REPORTS, { root })),
    );
    const before = readFileSync(
      join(root, 'data', SURVEY_REPORTS.file),
      'utf8',
    );

    const lines = await withLog(async (log) => {
      await withApi({ posts }, () => collectReports(SURVEY_REPORTS, { root }));
      return log;
    });
    assert.deepEqual(lines, [
      'No survey report changes detected; leaving catalog untouched.',
    ]);
    assert.equal(
      readFileSync(join(root, 'data', SURVEY_REPORTS.file), 'utf8'),
      before,
    );
  });
});

test('collectReports rewrites the file when a report changed', async () => {
  await withTempRoot(async (root) => {
    await withLog(() =>
      withApi({ posts: [post(1, 'one', '2024-01-01T00:00:00')] }, () =>
        collectReports(SURVEY_REPORTS, { root }),
      ),
    );
    const before = readData(root, SURVEY_REPORTS);
    const lines = await withLog(async (log) => {
      await withApi(
        { posts: [post(1, 'one', '2024-01-01T00:00:00', 'Renamed')] },
        () => collectReports(SURVEY_REPORTS, { root }),
      );
      return log;
    });
    const after = readData(root, SURVEY_REPORTS);
    assert.match(lines[0], /^Collected 1 survey reports at /);
    assert.equal(after.surveyReports[0].title, 'Renamed');
    assert.notEqual(after, before);
  });
});

test('collectReports writes nothing when no reports exist yet and the API returns none', async () => {
  await withTempRoot(async (root) => {
    const lines = await withLog(async (log) => {
      await withApi({ posts: [] }, () =>
        collectReports(SURVEY_REPORTS, { root }),
      );
      return log;
    });
    // No prior file means the no-change short-circuit cannot apply.
    assert.equal(existsSync(join(root, 'data', SURVEY_REPORTS.file)), true);
    assert.deepEqual(readData(root, SURVEY_REPORTS).surveyReports, []);
    assert.match(lines[0], /^Collected 0 survey reports at /);
  });
});

test('collectReports fails loudly when cncf.io no longer exposes the term', async () => {
  await withTempRoot(async (root) => {
    await withApi({ terms: [TERMS[0]], posts: [] }, async (requested) => {
      await assert.rejects(
        collectReports(SURVEY_REPORTS, { root }),
        /cncf\.io no longer exposes an lf-report-type term with slug "survey"/,
      );
      assert.equal(requested.length, 1, 'no report listing is requested');
    });
    assert.equal(existsSync(join(root, 'data', SURVEY_REPORTS.file)), false);
  });
});

function validData(type, overrides = {}) {
  return {
    generatedAt: '2024-01-01T00:00:00.000Z',
    sourceUrl: 'https://www.cncf.io/reports?_sft_lf-report-type=survey',
    [type.key]: [
      {
        id: 1,
        title: 'One',
        slug: 'one',
        url: 'https://www.cncf.io/reports/one/',
        publishedAt: '2024-01-01',
        summary: 'A real summary.',
      },
    ],
    ...overrides,
  };
}

test('validateReports accepts a well-formed file and reports the count', async () => {
  await withTempRoot((root) => {
    writeData(root, SURVEY_REPORTS, validData(SURVEY_REPORTS));
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    let result;
    try {
      result = withCapturedExit(() =>
        validateReports(SURVEY_REPORTS, { root }),
      );
    } finally {
      console.log = original;
    }
    assert.deepEqual(result.exitCodes, []);
    assert.equal(result.stderr, '');
    assert.deepEqual(lines, ['Validated 1 survey reports']);
  });
});

test('validateReports warns, without failing, on a placeholder summary', async () => {
  await withTempRoot((root) => {
    const data = validData(SURVEY_REPORTS);
    data.surveyReports[0].summary = PLACEHOLDER;
    writeData(root, SURVEY_REPORTS, data);
    const original = console.log;
    console.log = () => {};
    let result;
    try {
      result = withCapturedExit(() =>
        validateReports(SURVEY_REPORTS, { root }),
      );
    } finally {
      console.log = original;
    }
    assert.deepEqual(result.exitCodes, []);
    assert.match(result.stderr, /1 warning\(s\) in survey reports/);
    assert.match(
      result.stderr,
      /\[warn\] 1: summary is still the auto-generated placeholder/,
    );
  });
});

test('validateReports rejects a missing title, summary and a non-CNCF or userinfo url', async () => {
  await withTempRoot((root) => {
    writeData(
      root,
      RADAR_REPORTS,
      validData(RADAR_REPORTS, {
        radarReports: [
          { id: 1, url: 'https://evil.example/report/' },
          {
            id: 2,
            title: 'Two',
            url: 'https://www.cncf.io@evil.example/',
            summary: 'ok',
          },
          { id: 2, title: 'Dup', summary: 'ok' },
          {
            slug: 'no-id',
            title: 'No id',
            summary: 'ok',
            url: 'https://www.cncf.io/x/',
          },
        ],
      }),
    );
    const result = withCapturedExit(() =>
      validateReports(RADAR_REPORTS, { root }),
    );
    assert.deepEqual(result.exitCodes, [1]);
    assert.match(result.stderr, /error\(s\) in radar reports/);
    assert.match(result.stderr, /\[error\] 1: missing title/);
    assert.match(result.stderr, /\[error\] 1: missing summary/);
    assert.match(
      result.stderr,
      /\[error\] 1: url must be an https URL, with no userinfo, on cncf\.io(?: or [a-z.]+)*: "https:\/\/evil\.example\/report\/"/,
    );
    assert.match(
      result.stderr,
      /\[error\] 2: url must be an https URL[^\n]*"https:\/\/www\.cncf\.io@evil\.example\/"/,
    );
    assert.match(result.stderr, /\[error\] 2: duplicate or missing id/);
    assert.match(result.stderr, /\[error\] 2: url must be[^\n]*undefined/);
    assert.match(result.stderr, /\[error\] no-id: duplicate or missing id/);
  });
});

test('validateReports rejects an unparseable generatedAt, a bad sourceUrl and an empty list', async () => {
  await withTempRoot((root) => {
    writeData(root, SURVEY_REPORTS, {
      generatedAt: 'yesterday',
      sourceUrl: 'http://www.cncf.io/reports',
      surveyReports: [],
    });
    const result = withCapturedExit(() =>
      validateReports(SURVEY_REPORTS, { root }),
    );
    assert.deepEqual(result.exitCodes, [1]);
    assert.match(result.stderr, /generatedAt/);
    assert.match(result.stderr, /sourceUrl/);
    assert.match(result.stderr, /surveyReports/);
  });
});

test('validateReports treats a non-array report list as empty rather than crashing', async () => {
  await withTempRoot((root) => {
    writeData(
      root,
      SURVEY_REPORTS,
      validData(SURVEY_REPORTS, { surveyReports: { id: 1 } }),
    );
    const result = withCapturedExit(() =>
      validateReports(SURVEY_REPORTS, { root }),
    );
    assert.deepEqual(result.exitCodes, [1]);
    assert.match(result.stderr, /surveyReports/);
    assert.doesNotMatch(result.stderr, /missing title/);
  });
});
