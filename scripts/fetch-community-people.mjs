#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchTabRoster } from './lib/tab-roster.mjs';

const root = new URL('..', import.meta.url).pathname;
const output = join(root, 'data/community-people.json');
const rosterPath = join(root, 'data/community-roster.json');

const PEOPLE_JSON_URL = 'https://raw.githubusercontent.com/cncf/people/main/people.json';
const PEOPLE_IMAGE_BASE = 'https://raw.githubusercontent.com/cncf/people/main/images/';

const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
const fallbackImages = roster.fallbackImages;

const existing = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};
const existingPeople = existing.people || {};

let tabRoster;
try {
  tabRoster = await fetchTabRoster(root);
} catch (error) {
  console.error(`Refusing to write a degraded community-people.json: could not refresh the TAB roster from cncf/tab's gov.yaml: ${error.message}`);
  process.exit(1);
}

// cncf/people is the enrichment source for bio/location/links/image. If it
// can't be loaded at all, abort instead of writing a degraded file with a
// fresh fetchedAt that would look like a successful, up-to-date refresh.
let cncfPeopleByGithub;
try {
  cncfPeopleByGithub = await fetchCncfPeopleIndex();
} catch (error) {
  console.error(`Refusing to write a degraded community-people.json: could not load cncf/people/people.json: ${error.message}`);
  process.exit(1);
}

const people = { tab: tabRoster.entries, staff: roster.sections.staff };
const result = {};
let failures = 0;
let usedFallbackData = false;

for (const [section, entries] of Object.entries(people)) {
  result[section] = [];
  for (const { name, company, role, github, linkedin, twitter, seat } of entries) {
    const previous = existingPeople[section]?.find((person) => person.github === github && github) ?? {};
    const handle = github?.toLowerCase();
    const profile = (handle && cncfPeopleByGithub.get(handle)) || null;
    let usedFallback = false;
    if (github && !profile) {
      failures += 1;
      usedFallback = true;
      usedFallbackData = true;
      console.warn(`Could not find ${name} (github: ${github}) in cncf/people; keeping prior data`);
    }

    // Roster/gov.yaml values (name, company, role, seat) are authoritative;
    // cncf/people only fills in fields the roster doesn't provide.
    result[section].push({
      name: name || profile?.name || previous.name,
      company: company || profile?.company || previous.company,
      role: role || previous.role || null,
      bio: stripHtml(profile?.bio) || previous.bio || '',
      location: profile?.location || previous.location || '',
      image: profileImage(profile?.image) || previous.image || fallbackImages[name] || (github ? `https://github.com/${github}.png` : ''),
      github,
      linkedin: handleFromUrl(profile?.linkedin) || linkedin || previous.linkedin || null,
      twitter: handleFromUrl(profile?.twitter) || twitter || previous.twitter || null,
      blog: profile?.website || previous.blog || '',
      // profileUpdatedAt reflects when we last had a successful match in
      // cncf/people; keep the prior value when falling back so staleness is
      // observable.
      profileUpdatedAt: usedFallback ? previous.profileUpdatedAt || null : new Date().toISOString(),
      seat: seat || previous.seat || null
    });
  }
}

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      // Do not advance fetchedAt to "now" when any entry fell back to prior
      // data — the file as a whole isn't a clean, current snapshot.
      fetchedAt: usedFallbackData ? existing.fetchedAt || new Date().toISOString() : new Date().toISOString(),
      tabSource: { repo: 'cncf/tab', path: 'gov.yaml', revision: tabRoster.revision },
      peopleSource: { repo: 'cncf/people', path: 'people.json' },
      people: result
    },
    null,
    2
  ) + '\n'
);
console.log(`Refreshed ${Object.values(result).flat().length} community profiles${failures ? ` (${failures} fallback${failures === 1 ? '' : 's'})` : ''} (TAB roster @ cncf/tab#${tabRoster.revision.slice(0, 7)})`);

async function fetchCncfPeopleIndex() {
  const response = await fetch(PEOPLE_JSON_URL);
  if (!response.ok) throw new Error(`cncf/people returned ${response.status}`);
  const entries = await response.json();
  const byGithub = new Map();
  for (const entry of entries) {
    const handle = handleFromUrl(entry.github)?.toLowerCase();
    if (handle) byGithub.set(handle, entry);
  }
  return byGithub;
}

function profileImage(image) {
  if (!image) return '';
  if (/^https?:\/\//i.test(image)) return image;
  return `${PEOPLE_IMAGE_BASE}${image}`;
}

function handleFromUrl(value) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  const segments = trimmed.split('/');
  return segments[segments.length - 1] || null;
}

// Converts a cncf/people HTML bio to plain text, preserving word/sentence
// boundaries: block-level tags become whitespace before the remaining tags
// are stripped, so e.g. "</p><p>" doesn't join two sentences together.
function stripHtml(value) {
  if (!value) return '';
  return value
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
