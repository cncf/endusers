// Fetches the CNCF End User TAB roster from the authoritative source of truth:
// cncf/tab's gov.yaml. Curated supplemental identity fields (linkedin/twitter,
// or a github handle when gov.yaml omits one) are layered on top from
// data/tab-overrides.json. gov.yaml values always win on conflict; mismatches
// are logged so drift can be resolved explicitly rather than silently.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const GOV_REPO = 'cncf/tab';
const GOV_PATH = 'gov.yaml';

function buildHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cncf-endusers-site-build',
  };
  if (process.env.GH_TOKEN) headers.Authorization = `token ${process.env.GH_TOKEN}`;
  return headers;
}

async function fetchLatestRevision(headers) {
  const url = `https://api.github.com/repos/${GOV_REPO}/commits?path=${GOV_PATH}&per_page=1`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Could not list commits for ${GOV_REPO}/${GOV_PATH}: GitHub returned ${response.status}`);
  const commits = await response.json();
  const sha = commits[0]?.sha;
  if (!sha) throw new Error(`No commits found for ${GOV_REPO}/${GOV_PATH}`);
  return sha;
}

async function fetchGovYamlAt(revision) {
  const url = `https://raw.githubusercontent.com/${GOV_REPO}/${revision}/${GOV_PATH}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.text();
}

function findOverride(overrides, entry) {
  return overrides.find(({ match }) => {
    if (match.github) return match.github === entry.github;
    if (match.name) return match.name === entry.name;
    return false;
  });
}

function mergeOverride(entry, overrides) {
  const override = findOverride(overrides, entry);
  if (!override) return { ...entry };

  if (override.company && override.company !== entry.company) {
    console.warn(
      `TAB roster: curated company "${override.company}" for ${entry.name} does not match gov.yaml company "${entry.company}". Using gov.yaml (authoritative).`
    );
  }

  return {
    ...entry,
    github: entry.github || override.github || null,
    linkedin: override.linkedin || null,
    twitter: override.twitter || null,
  };
}

/**
 * Fetches and normalizes the current TAB roster from cncf/tab's gov.yaml.
 * @param {string} root - repository root, used to locate data/tab-overrides.json
 * @returns {Promise<{ entries: Array, revision: string, fetchedAt: string }>}
 */
export async function fetchTabRoster(root) {
  const headers = buildHeaders();
  const revision = await fetchLatestRevision(headers);
  const raw = await fetchGovYamlAt(revision);
  const doc = yaml.load(raw);
  const board = doc?.tab?.[0];
  if (!board) throw new Error('gov.yaml did not contain the expected tab[0] structure');

  const overridesPath = join(root, 'data/tab-overrides.json');
  const { overrides } = JSON.parse(readFileSync(overridesPath, 'utf8'));

  const leadership = (board.leadership || []).map((member) => ({
    name: member.name,
    company: member.company || null,
    role: member.role || null,
    github: member.github || null,
    seat: member.seat || null,
  }));
  const members = (board.members || []).map((member) => ({
    name: member.name,
    company: member.company || null,
    role: null,
    github: member.github || null,
    seat: member.seat || null,
  }));

  const entries = [...leadership, ...members].map((entry) => mergeOverride(entry, overrides));

  return { entries, revision, fetchedAt: new Date().toISOString() };
}
