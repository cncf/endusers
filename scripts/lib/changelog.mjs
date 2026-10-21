// Changelog generation for docs/resources/changelog.md.
//
// The public feedback loop (#1408) needs a page where a returning reader can
// see what changed on the site. The mechanism is a build-time rendering of
// `git log --first-parent`: every commit on main arrives by squash merge, so
// each first-parent subject is one pull request title in Conventional
// Commits form. A hand-curated changelog goes stale; this one cannot,
// because it is regenerated from history on every build.
//
// One wrinkle: actions/checkout fetches with depth 1 unless told otherwise,
// so the deploy job has no history to render. A shallow checkout renders
// FALLBACK_BODY instead of a one-entry fiction, and the page links the live
// merged-pull-request view on GitHub, which needs no history at all. The
// full rendering returns once the deploy checkout fetches full history.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Commit types a returning reader can see on the site. chore/ci/test/build/
// style/refactor churn is real work but invisible to a visitor, and listing
// it would drown the signal the page exists for.
const READER_VISIBLE_TYPES = new Set(['feat', 'fix', 'docs', 'perf']);

// The page is a sidebar document, not an infinite scroll: past this many
// entries the newest still render and the rest are one click away in the
// commit history link at the bottom.
export const MAX_ENTRIES = 200;

const COMMIT_URL = 'https://github.com/cncf/endusers/commit/';
const PULL_URL = 'https://github.com/cncf/endusers/pull/';
const MERGED_PRS_URL =
  'https://github.com/cncf/endusers/pulls?q=is%3Apr+is%3Amerged+sort%3Aupdated-desc';
const COMMITS_URL = 'https://github.com/cncf/endusers/commits/main';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// One `git log --format=%H%x1f%cI%x1f%s` line: hash, commit date, subject.
export function parseGitLog(output) {
  return output
    .split('\n')
    .filter((line) => line.includes('\x1f'))
    .map((line) => {
      const [hash, date, ...subject] = line.split('\x1f');
      return { hash, date, subject: subject.join('\x1f') };
    });
}

// Maps one commit to a changelog entry, or null when the commit is not
// reader-visible. Non-conventional subjects (a direct push, an imported
// history commit) are kept rather than dropped: a reader would rather see an
// untyped change than a hole in the record.
export function toEntry({ hash, date, subject }) {
  const pull = subject.match(/\s*\(#(\d+)\)\s*$/);
  const withoutPull = pull
    ? subject.slice(0, subject.length - pull[0].length)
    : subject;
  const conventional = withoutPull.match(
    /^([A-Za-z]+)(?:\([^)]*\))?!?:\s*(.+)$/,
  );
  if (conventional && !READER_VISIBLE_TYPES.has(conventional[1])) {
    return null;
  }
  const summary = conventional ? conventional[2] : withoutPull;
  return {
    month: date.slice(0, 7),
    summary,
    pr: pull ? pull[1] : null,
    hash,
  };
}

export function selectEntries(commits) {
  return commits.map(toEntry).filter((entry) => entry !== null);
}

// '2026-10' -> 'October 2026'. Month names come from a table rather than
// Date/Intl so the output is identical whatever TZ or ICU the build host has.
export function monthHeading(month) {
  const [year, index] = month.split('-');
  return `${MONTH_NAMES[Number(index) - 1]} ${year}`;
}

// A summary is a commit subject: arbitrary prose that can carry markdown
// and MDX syntax. The page compiles as MDX, so an unescaped `<style>` or
// `{foo}` in a subject is a build failure, and a `[` desyncs the link. Escape
// the lot; the entities render as the literal characters.
export function escapeLinkText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function entryLine({ summary, pr, hash }) {
  const text = escapeLinkText(summary);
  if (pr !== null) return `- [${text}](${PULL_URL}${pr})`;
  return `- [${text}](${COMMIT_URL}${hash})`;
}

export function renderChangelog(entries) {
  const shown = entries.slice(0, MAX_ENTRIES);
  const lines = [];
  let currentMonth = null;
  for (const entry of shown) {
    if (entry.month !== currentMonth) {
      if (currentMonth !== null) lines.push('');
      lines.push(`## ${monthHeading(entry.month)}`, '');
      currentMonth = entry.month;
    }
    lines.push(entryLine(entry));
  }
  if (entries.length > shown.length) {
    lines.push('', `Older changes: see the [commit history](${COMMITS_URL}).`);
  }
  return lines.join('\n');
}

// Rendered when the build host has no usable git history — a shallow CI
// checkout, or a source archive with no .git at all. The links it carries
// are live views GitHub maintains, so the page is accurate with zero upkeep.
export const FALLBACK_BODY = `This site is built from a shallow checkout, so the changelog cannot be
rendered from git history here. GitHub keeps the live record:

- [Recently merged pull requests](${MERGED_PRS_URL}) — every change to the
  site, newest first.
- [Commit history](${COMMITS_URL}) — the same record commit by commit.
`;

export function renderPage(body) {
  // MDX comment, not an HTML one: this repo's docs compile as MDX, which
  // rejects `<!-- -->`.
  return `---
title: Changelog
description: What changed on the CNCF End User Community site, newest first.
sidebar_position: 8
---

{/*
  Generated by scripts/generate-changelog.mjs at build time from git
  history. Do not edit by hand; the next build replaces this file.
*/}

${body}
`;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// The first-parent history of a full checkout, or null when there is none:
// the checkout is shallow, git is missing, or root is not a repository at
// all. A shallow checkout has history, just not enough of it — rendering
// one commit as "the changelog" would be worse than the fallback.
export function readHistory(root) {
  try {
    if (
      git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false'
    ) {
      return null;
    }
    return git(root, ['log', '--first-parent', '--format=%H%x1f%cI%x1f%s']);
  } catch {
    return null;
  }
}

// Generates the changelog page under root, returning a one-line summary of
// what was written for the build log.
export function generateChangelog(root) {
  const history = readHistory(root);
  const entries = history === null ? [] : selectEntries(parseGitLog(history));
  const page = renderPage(
    entries.length > 0 ? renderChangelog(entries) : FALLBACK_BODY,
  );
  const target = join(root, 'docs', 'resources', 'changelog.md');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, page);
  return entries.length > 0
    ? `wrote ${entries.length} changelog entries`
    : 'wrote changelog fallback (no full git history available)';
}
