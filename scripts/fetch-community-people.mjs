#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGitHubHeaders } from './lib/github.mjs';

// GitHub usernames are alphanumerics plus single internal hyphens, 1-39 chars.
// A roster handle containing a path separator, dot segment, query or fragment
// marker would re-point the api.github.com request at a different endpoint and
// publish that response as somebody's profile, so reject it before fetching.
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'data/community-people.json');
const rosterPath = join(root, 'data/community-roster.json');

const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
const people = roster.sections;
const fallbackImages = roster.fallbackImages;

const existing = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};
const result = {};
let failures = 0;

const headers = makeGitHubHeaders(process.env.GH_TOKEN);

for (const [section, entries] of Object.entries(people)) {
  result[section] = [];
  for (const { name, company, role, github, linkedin, twitter } of entries) {
    const previous = existing[section]?.find((person) => person.github === github && github) ?? {};
    let profile = {};
    if (github && !GITHUB_HANDLE.test(github)) {
      console.error(
        `data/community-roster.json: ${name} has an invalid GitHub handle: ${JSON.stringify(github)}`,
      );
      process.exit(1);
    }
    if (github) {
      try {
        const response = await fetch(
          `https://api.github.com/users/${encodeURIComponent(github)}`,
          { headers },
        );
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        profile = await response.json();
      } catch (error) {
        failures += 1;
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
      profileUpdatedAt: profile.updated_at || previous.profileUpdatedAt || null
    });
  }
}

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(output, JSON.stringify({ fetchedAt: new Date().toISOString(), people: result }, null, 2) + '\n');
console.log(`Refreshed ${Object.values(result).flat().length} community profiles${failures ? ` (${failures} fallback${failures === 1 ? '' : 's'})` : ''}`);

function cleanCompany(value) {
  return value?.replace(/^@/, '').trim() || '';
}
