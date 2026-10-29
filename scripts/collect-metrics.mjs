#!/usr/bin/env node
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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { githubAllPages, makeGitHubHeaders } from './lib/github.mjs';
import { cloneShallow, revParseHead } from './lib/git-source.mjs';
import { readLandscape } from './lib/landscape-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'cncf-metrics-'));
const landscapeDir = join(work, 'landscape');
const architectureDir = join(work, 'architecture');
try {
  const { revision: landscapeCommit, document: source } =
    readLandscape(landscapeDir);
  cloneShallow('https://github.com/cncf/architecture.git', architectureDir);
  const architectureCommit = revParseHead(architectureDir);
  const architectureHistory = architectureDir;
  execFileSync('git', ['-C', architectureHistory, 'fetch', '--unshallow'], {
    stdio: 'ignore',
  });
  execFileSync('git', ['-C', landscapeDir, 'fetch', '--unshallow'], {
    stdio: 'ignore',
  });
  const projects = [];
  // Null-prototype tallies: the keys below are upstream landscape.yml strings
  // (category.name, project.project), so on a plain object a category named
  // "constructor" would read Object.prototype's function through `|| 0` and
  // publish a string where a count belongs, and one named "__proto__" would be
  // dropped by the setter without an error. Same reason the lookup tables in
  // generate-members.mjs use Object.create(null).
  const categoryCounts = Object.create(null);
  const maturityCounts = Object.create(null);
  for (const category of source.landscape || []) {
    for (const subcategory of category.subcategories || []) {
      for (const item of subcategory.items || []) {
        for (const project of item.items || [item]) {
          if (project.project) {
            projects.push(project);
            const categoryName = category.name || 'Other';
            categoryCounts[categoryName] =
              (categoryCounts[categoryName] || 0) + 1;
            const maturity = String(project.project).toLowerCase();
            maturityCounts[maturity] = (maturityCounts[maturity] || 0) + 1;
          }
        }
      }
    }
  }
  // Dirent.isDirectory() is false for a symlink, so a symlinked architecture
  // directory upstream would drop out of the published count with no trace.
  // Skip it explicitly and leave the drop visible in the workflow log
  // (#1276).
  const architecturesRoot = join(architectureDir, 'content/en/architectures');
  const architectures = readdirSync(architecturesRoot, {
    withFileTypes: true,
  }).filter((entry) => {
    if (!entry.isSymbolicLink()) return entry.isDirectory();
    console.warn(
      `Skipping symlink ${join(architecturesRoot, entry.name)}: symlinked architecture directories are not counted`,
    );
    return false;
  });
  const architectureTimeline = architectureTimelineData(
    architectureHistory,
    new Set(architectures.map((entry) => entry.name)),
  );
  const memberHistory = memberTimeline(landscapeDir);
  const lifecycle = await collectLifecycleMetrics();
  const generatedAt = new Date().toISOString();
  const data = {
    generated: true,
    generatedAt,
    sources: {
      landscape: {
        repository: 'https://github.com/cncf/landscape',
        revision: landscapeCommit,
        sourceUrl: `https://github.com/cncf/landscape/blob/${landscapeCommit}/landscape.yml`,
      },
      architectures: {
        repository: 'https://github.com/cncf/architecture',
        revision: architectureCommit,
        sourceUrl:
          'https://github.com/cncf/architecture/tree/main/content/en/architectures',
      },
    },
    metrics: [
      metric(
        'cncf-projects',
        'CNCF projects',
        projects.length,
        'landscape',
        'https://landscape.cncf.io/',
        generatedAt,
        'Projects explicitly marked with a CNCF maturity level in landscape.yml.',
      ),
      metric(
        'reference-architectures',
        'Reference architectures',
        architectures.length,
        'architectures',
        'https://github.com/cncf/architecture/tree/main/content/en/architectures',
        generatedAt,
        'Published architecture directories under content/en/architectures.',
      ),
    ],
    breakdowns: {
      projectCategories: breakdown(
        'Project categories',
        categoryCounts,
        'landscape',
        'https://landscape.cncf.io/',
      ),
      projectMaturity: breakdown(
        'Project maturity',
        maturityCounts,
        'landscape',
        'https://landscape.cncf.io/',
      ),
    },
    series: {
      endUserMembers: {
        label: 'CNCF member companies',
        source: 'landscape',
        sourceUrl: 'https://landscape.cncf.io/',
        values: memberHistory,
      },
      referenceArchitectures: {
        label: 'Reference architecture submissions',
        source: 'architectures',
        sourceUrl:
          'https://github.com/cncf/architecture/tree/main/content/en/architectures',
        values: architectureTimeline,
      },
    },
    referenceArchitectureLifecycle: lifecycle,
    omitted: [
      {
        id: 'member-companies',
        reason:
          'The landscape data does not expose an unambiguous end-user membership field.',
      },
      {
        id: 'slack-members',
        reason:
          'No authoritative GitHub source provides a reliable current count.',
      },
      {
        id: 'conference-attendance',
        reason:
          'Attendance is not collected from the authoritative repositories.',
      },
    ],
  };
  // Only bump generatedAt and rewrite the file when the metrics themselves
  // changed (ADR 0009). The counts and series are stable for weeks at a
  // time, so touching the envelope on every weekly refresh-metrics.yml run
  // would open a no-op PR each time (#1935). generatedAt, each metric's
  // collectedAt, the lifecycle observedAt, the upstream source revisions and
  // the as-of date stamped on the single-point member series are this run's
  // envelope: they record when the published data last changed, so they are
  // excluded from the comparison and stay pinned to the run that last
  // changed it. A real change still diffs: series gain points and counts
  // move, and the median-age card is rounded coarsely enough to sit still
  // between genuinely different readings.
  const outputPath = join(root, 'data/metrics.json');
  const contentOnly = (value) =>
    JSON.stringify(value, (key, field) =>
      key === 'generatedAt' ||
      key === 'collectedAt' ||
      key === 'observedAt' ||
      key === 'sources' ||
      key === 'date'
        ? undefined
        : field,
    );
  if (
    existsSync(outputPath) &&
    contentOnly(JSON.parse(readFileSync(outputPath, 'utf8'))) ===
      contentOnly(data)
  ) {
    console.log(
      'No metric changes detected; leaving data/metrics.json untouched.',
    );
  } else {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n');
    console.log(`Collected ${data.metrics.length} metrics at ${generatedAt}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
function metric(id, label, value, source, href, collectedAt, note) {
  return { id, label, value, source, sourceUrl: href, collectedAt, note };
}
function breakdown(label, values, source, href) {
  return {
    label,
    source,
    sourceUrl: href,
    values: Object.entries(values)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value })),
  };
}
function memberTimeline(dir) {
  const content = readFileSync(join(dir, 'landscape.yml'), 'utf8');
  // landscape.yml writes a member card once per subcategory it is placed in,
  // so a company cross-listed under both "CNCF Members" and a product category
  // appears twice. Count distinct names, not matching lines.
  const names = new Set(
    (content.match(/^\s+name: .*\(member\)$/gm) || []).map((line) =>
      line.trim(),
    ),
  );
  return [{ date: new Date().toISOString().slice(0, 10), value: names.size }];
}
async function collectLifecycleMetrics() {
  const headers = makeGitHubHeaders(
    process.env.GH_TOKEN,
    'cncf-endusers-metrics',
  );
  const [issues, pulls] = await Promise.all([
    githubAllPages(
      'https://api.github.com/repos/cncf/tab/issues?state=all&per_page=100',
      headers,
    ),
    githubAllPages(
      'https://api.github.com/repos/cncf/architecture/pulls?state=all&per_page=100',
      headers,
    ),
  ]);
  const submissions = issues.filter(
    (item) =>
      !item.pull_request &&
      item.labels?.some((label) => /reference-architecture/i.test(label.name)),
  );
  const architecturePRs = [];
  for (const pull of pulls) {
    let files = [];
    try {
      files = await githubAllPages(
        `https://api.github.com/repos/cncf/architecture/pulls/${pull.number}/files?per_page=100`,
        headers,
      );
    } catch (error) {
      console.warn(
        `Could not inspect PR #${pull.number} files (${error.message}); using title/body fallback.`,
      );
    }
    if (
      files.some((file) =>
        file.filename.startsWith('content/en/architectures/'),
      ) ||
      /architecture/i.test(`${pull.title} ${pull.body || ''}`)
    )
      architecturePRs.push(pull);
  }
  const now = Date.now();
  const ages = submissions
    .filter((item) => item.state === 'open')
    .map((item) => Math.max(0, now - Date.parse(item.created_at)) / 86400000);
  const merged = architecturePRs.filter((item) => item.merged_at);
  const cycleDays = merged.map(
    (item) =>
      (Date.parse(item.merged_at) - Date.parse(item.created_at)) / 86400000,
  );
  const mergedTrend = monthlyCounts(merged.map((item) => item.merged_at));
  return {
    generated: true,
    source: 'cncf/tab and cncf/architecture GitHub APIs',
    sourceUrl:
      'https://github.com/cncf/tab/issues?q=is%3Aissue+label%3Aarea%2Freference-architecture',
    observedAt: new Date().toISOString(),
    cards: [
      {
        id: 'open-submissions',
        label: 'Open submissions',
        value: submissions.filter((item) => item.state === 'open').length,
        note: 'Open TAB issues labeled as reference-architecture submissions.',
      },
      {
        id: 'open-architecture-prs',
        label: 'Open architecture PRs',
        value: architecturePRs.filter((item) => item.state === 'open').length,
        note: 'Architecture PRs identified from public GitHub metadata.',
      },
      {
        id: 'median-submission-age',
        label: 'Median submission age',
        value: median(ages),
        // median() returns 0 for an empty sample; the dashboard needs the
        // sample size to tell "no open submissions" from "zero days".
        sampleSize: ages.length,
        suffix: 'days',
        note: 'Time since open submission issue creation; not end-to-end review time.',
      },
      {
        id: 'median-pr-cycle',
        label: 'Median public PR cycle',
        value: median(cycleDays),
        sampleSize: cycleDays.length,
        suffix: 'days',
        note: 'Creation to merge for merged architecture PRs; a public GitHub proxy.',
      },
    ],
    trends: {
      submissions: {
        label: 'Open submissions by month',
        values: monthlyCounts(
          submissions
            .filter((item) => item.state === 'open')
            .map((item) => item.created_at),
        ),
      },
      publications: {
        label: 'Architecture PRs merged by month',
        values: mergedTrend,
      },
    },
    omitted: [
      {
        id: 'acceptance-rate',
        reason:
          'Acceptance is not represented as a consistent public GitHub state.',
      },
      {
        id: 'validation-duration',
        reason: 'Validation timestamps are not consistently recorded.',
      },
      {
        id: 'announcement-rate',
        reason:
          'Announcement events are not represented as structured repository data.',
      },
    ],
  };
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (
    Math.round(
      (sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2) * 10,
    ) / 10
  );
}
function monthlyCounts(dates) {
  const counts = {};
  for (const date of dates) {
    const month = date.slice(0, 7);
    counts[month] = (counts[month] || 0) + 1;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

// One cumulative point per month, counting each architecture directory once at
// the commit that first added a file under it. `git log --format=%aI` alone
// counts commits, so an edit to an existing architecture would register as a
// new submission. Only directories still published are counted, so a
// submission that was later withdrawn upstream does not leave the series one
// ahead of the stat card for good.
function architectureTimelineData(dir, published) {
  const log = execFileSync(
    'git',
    [
      '-C',
      dir,
      'log',
      '--reverse',
      '--format=%aI',
      '--name-only',
      '--diff-filter=A',
      '--',
      'content/en/architectures',
    ],
    { encoding: 'utf8' },
  );
  // --reverse walks oldest-first, so the first commit a directory appears
  // under is the one that introduced it.
  const added = new Map();
  let month = null;
  for (const line of log.split('\n')) {
    if (!line) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      month = line.slice(0, 7);
      continue;
    }
    // content/en/architectures/<id>/<rest>: a path with no <rest> is a loose
    // file in the root, not an architecture, and the stat card does not count
    // it either.
    const parts = line.split('/');
    if (parts.length < 5) continue;
    if (!published.has(parts[3])) continue;
    if (added.has(parts[3])) continue;
    added.set(parts[3], month);
  }
  const months = {};
  for (const value of added.values()) months[value] = (months[value] || 0) + 1;
  let total = 0;
  return Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value: (total += value) }));
}
