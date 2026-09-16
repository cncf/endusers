#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { makeGitHubHeaders } from './lib/github.mjs';

const root = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'cncf-metrics-'));
const landscapeDir = join(work, 'landscape');
const architectureDir = join(work, 'architecture');
try {
  clone('https://github.com/cncf/landscape.git', landscapeDir, true);
  clone('https://github.com/cncf/architecture.git', architectureDir, true);
  const landscapeCommit = git(landscapeDir, 'rev-parse', 'HEAD');
  const architectureCommit = git(architectureDir, 'rev-parse', 'HEAD');
  const architectureHistory = architectureDir;
  execFileSync('git', ['-C', architectureHistory, 'fetch', '--unshallow'], { stdio: 'ignore' });
  execFileSync('git', ['-C', landscapeDir, 'fetch', '--unshallow'], { stdio: 'ignore' });
  const source = parse(readFileSync(join(landscapeDir, 'landscape.yml'), 'utf8'));
  const projects = [];
  const categoryCounts = {};
  const maturityCounts = {};
  for (const category of source.landscape || []) {
    for (const subcategory of category.subcategories || []) {
      for (const item of subcategory.items || []) {
        for (const project of item.items || [item]) {
          if (project.project) {
            projects.push(project);
            const categoryName = category.name || 'Other';
            categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;
            const maturity = String(project.project).toLowerCase();
            maturityCounts[maturity] = (maturityCounts[maturity] || 0) + 1;
          }
        }
      }
    }
  }
  const architectures = readdirSync(join(architectureDir, 'content/en/architectures'), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const architectureTimeline = architectureTimelineData(architectureHistory);
  const memberHistory = memberTimeline(landscapeDir);
  const lifecycle = await collectLifecycleMetrics();
  const generatedAt = new Date().toISOString();
  const data = {
    generated: true,
    generatedAt,
    sources: {
      landscape: { repository: 'https://github.com/cncf/landscape', revision: landscapeCommit, sourceUrl: 'https://github.com/cncf/landscape/blob/main/landscape.yml' },
      architectures: { repository: 'https://github.com/cncf/architecture', revision: architectureCommit, sourceUrl: 'https://github.com/cncf/architecture/tree/main/content/en/architectures' }
    },
    metrics: [
      metric('cncf-projects', 'CNCF projects', projects.length, 'landscape', 'https://landscape.cncf.io/', generatedAt, 'Projects explicitly marked with a CNCF maturity level in landscape.yml.'),
      metric('reference-architectures', 'Reference architectures', architectures.length, 'architectures', 'https://github.com/cncf/architecture/tree/main/content/en/architectures', generatedAt, 'Published architecture directories under content/en/architectures.')
    ],
    breakdowns: {
      projectCategories: breakdown('Project categories', categoryCounts, 'landscape', 'https://landscape.cncf.io/'),
      projectMaturity: breakdown('Project maturity', maturityCounts, 'landscape', 'https://landscape.cncf.io/')
    },
    series: {
      endUserMembers: { label: 'CNCF member companies', source: 'landscape', sourceUrl: 'https://landscape.cncf.io/', values: memberHistory },
      referenceArchitectures: { label: 'Reference architecture submissions', source: 'architectures', sourceUrl: 'https://github.com/cncf/architecture/commits/main/content/en/architectures', values: architectureTimeline }
    },
    referenceArchitectureLifecycle: lifecycle,
    omitted: [
      { id: 'member-companies', reason: 'The landscape data does not expose an unambiguous end-user membership field.' },
      { id: 'slack-members', reason: 'No authoritative GitHub source provides a reliable current count.' },
      { id: 'conference-attendance', reason: 'Attendance is not collected from the authoritative repositories.' }
    ]
  };
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data/metrics.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(`Collected ${data.metrics.length} metrics at ${generatedAt}`);
} finally { rmSync(work, { recursive: true, force: true }); }
function clone(url, destination, shallow = false) { execFileSync('git', ['clone', ...(shallow ? ['--depth', '1'] : []), url, destination], { stdio: 'inherit' }); }
function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); }
function metric(id, label, value, source, href, collectedAt, note) { return { id, label, value, source, sourceUrl: href, collectedAt, note }; }
function breakdown(label, values, source, href) { return { label, source, sourceUrl: href, values: Object.entries(values).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value })) }; }
function memberTimeline(dir) {
  const content = readFileSync(join(dir, 'landscape.yml'), 'utf8');
  const value = (content.match(/^\s+name: .*\(member\)$/gm) || []).length;
  return [{ date: new Date().toISOString().slice(0, 10), value }];
}
async function collectLifecycleMetrics() {
  const headers = makeGitHubHeaders(process.env.GH_TOKEN, 'cncf-endusers-metrics');
  const [issues, pulls] = await Promise.all([
    githubAll('https://api.github.com/repos/cncf/tab/issues?state=all&per_page=100', headers),
    githubAll('https://api.github.com/repos/cncf/architecture/pulls?state=all&per_page=100', headers)
  ]);
  const submissions = issues.filter((item) => !item.pull_request && item.labels?.some((label) => /reference-architecture/i.test(label.name)));
  const architecturePRs = [];
  for (const pull of pulls) {
    let files = [];
    try { files = await githubAll(`https://api.github.com/repos/cncf/architecture/pulls/${pull.number}/files?per_page=100`, headers); } catch (error) { console.warn(`Could not inspect PR #${pull.number} files (${error.message}); using title/body fallback.`); }
    if (files.some((file) => file.filename.startsWith('content/en/architectures/')) || /architecture/i.test(`${pull.title} ${pull.body || ''}`)) architecturePRs.push(pull);
  }
  const now = Date.now();
  const ages = submissions.filter((item) => item.state === 'open').map((item) => Math.max(0, now - Date.parse(item.created_at)) / 86400000);
  const merged = architecturePRs.filter((item) => item.merged_at);
  const cycleDays = merged.map((item) => (Date.parse(item.merged_at) - Date.parse(item.created_at)) / 86400000);
  const mergedTrend = monthlyCounts(merged.map((item) => item.merged_at));
  return {
    generated: true,
    source: 'cncf/tab and cncf/architecture GitHub APIs',
    sourceUrl: 'https://github.com/cncf/tab/issues?q=is%3Aissue+label%3Aarea%2Freference-architecture',
    observedAt: new Date().toISOString(),
    cards: [
      { id: 'open-submissions', label: 'Open submissions', value: submissions.filter((item) => item.state === 'open').length, note: 'Open TAB issues labeled as reference-architecture submissions.' },
      { id: 'open-architecture-prs', label: 'Open architecture PRs', value: architecturePRs.filter((item) => item.state === 'open').length, note: 'Architecture PRs identified from public GitHub metadata.' },
      { id: 'median-submission-age', label: 'Median submission age', value: median(ages), suffix: 'days', note: 'Time since open submission issue creation; not end-to-end review time.' },
      { id: 'median-pr-cycle', label: 'Median public PR cycle', value: median(cycleDays), suffix: 'days', note: 'Creation to merge for merged architecture PRs; a public GitHub proxy.' }
    ],
    trends: {
      submissions: { label: 'Open submissions by month', values: monthlyCounts(submissions.filter((item) => item.state === 'open').map((item) => item.created_at)) },
      publications: { label: 'Architecture PRs merged by month', values: mergedTrend }
    },
    omitted: [
      { id: 'acceptance-rate', reason: 'Acceptance is not represented as a consistent public GitHub state.' },
      { id: 'validation-duration', reason: 'Validation timestamps are not consistently recorded.' },
      { id: 'announcement-rate', reason: 'Announcement events are not represented as structured repository data.' }
    ]
  };
}
async function githubAll(url, headers) {
  const results = [];
  let next = url;
  while (next) {
    const response = await fetch(next, { headers });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${next}`);
    results.push(...await response.json());
    const link = response.headers.get('link') || '';
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    next = match ? match[1] : null;
  }
  return results;
}
async function github(url, headers) { const response = await fetch(url, { headers }); if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`); return response.json(); }
function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return Math.round((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10; }
function monthlyCounts(dates) { const counts = {}; for (const date of dates) { const month = date.slice(0, 7); counts[month] = (counts[month] || 0) + 1; } return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })); }

function architectureTimelineData(dir) {
  const commits = execFileSync('git', ['-C', dir, 'log', '--format=%aI', '--', 'content/en/architectures'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const months = {};
  for (const date of commits) { const month = date.slice(0, 7); months[month] = (months[month] || 0) + 1; }
  let total = 0;
  return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value: total += value }));
}
