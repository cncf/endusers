#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const output = join(root, 'data/community-people.json');
const rosterPath = join(root, 'data/community-roster.json');

const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
const people = roster.sections;
const fallbackImages = roster.fallbackImages;

const existing = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};
// Fallback data lives under .people, not at the top level of the file — a
// lookup against `existing[section]` silently found nothing and dropped all
// prior enrichment on every run.
const existingPeople = existing.people || {};
const result = {};
let failures = 0;
let usedFallbackData = false;

for (const [section, entries] of Object.entries(people)) {
  result[section] = [];
  for (const { name, company, role, github, linkedin, twitter } of entries) {
    const previous = existingPeople[section]?.find((person) => person.github === github && github) ?? {};
    let profile = {};
    let usedFallback = false;
    if (github) {
      try {
        const response = await fetch(`https://api.github.com/users/${github}`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cncf-endusers-site-build' },
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        profile = await response.json();
      } catch (error) {
        failures += 1;
        usedFallback = true;
        usedFallbackData = true;
        console.warn(`Could not refresh ${name}: ${error.message}`);
      }
    }
    result[section].push({
      name: profile.name || previous.name || name,
      company: cleanCompany(profile.company) || previous.company || company,
      role: role || previous.role || null,
      bio: profile.bio || previous.bio || '',
      location: profile.location || previous.location || '',
      image: profile.avatar_url || previous.image || fallbackImages[name] || (github ? `https://github.com/${github}.png` : ''),
      github,
      linkedin: linkedin || previous.linkedin || null,
      twitter: twitter || previous.twitter || null,
      blog: profile.blog || previous.blog || '',
      publicRepos: profile.public_repos ?? previous.publicRepos ?? 0,
      followers: profile.followers ?? previous.followers ?? 0,
      // Do not advance profileUpdatedAt when we fell back to prior data —
      // it wasn't actually refreshed this run.
      profileUpdatedAt: usedFallback ? previous.profileUpdatedAt || null : profile.updated_at || previous.profileUpdatedAt || null,
    });
  }
}

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      // Do not advance the top-level fetchedAt to "now" when any entry fell
      // back to prior data — the file as a whole isn't a clean, current
      // snapshot, and a fresh timestamp would hide that from the staleness
      // validator/UI.
      fetchedAt: usedFallbackData ? existing.fetchedAt || new Date().toISOString() : new Date().toISOString(),
      people: result,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Refreshed ${Object.values(result).flat().length} community profiles${failures ? ` (${failures} fallback${failures === 1 ? '' : 's'})` : ''}`);

function cleanCompany(value) {
  return value?.replace(/^@/, '').trim() || '';
}
