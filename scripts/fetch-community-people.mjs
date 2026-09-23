#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstAllowedImageUrl, profileImageUrl } from './lib/profile-image.mjs';

// GitHub usernames are alphanumerics plus single internal hyphens, 1-39 chars.
// A roster handle containing a path separator, dot segment, query or fragment
// marker would re-point requests built from it at a different endpoint and
// publish that response as somebody's profile, so reject it before matching.
const GITHUB_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

const PEOPLE_JSON_URL =
  'https://raw.githubusercontent.com/cncf/people/main/people.json';
const PEOPLE_IMAGE_BASE =
  'https://raw.githubusercontent.com/cncf/people/main/images/';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'data/community-people.json');
const rosterPath = join(root, 'data/community-roster.json');

const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
const people = roster.sections;
const fallbackImages = roster.fallbackImages;

const existing = existsSync(output)
  ? JSON.parse(readFileSync(output, 'utf8'))
  : {};
const existingPeople = existing.people ?? {};

// Extracts the bare handle from a cncf/people github field, which is a full
// profile URL (e.g. "https://github.com/octocat") rather than a handle.
function handleFromUrl(url) {
  if (!url) return null;
  const match = /github\.com\/([^/?#]+)/i.exec(url);
  return match ? match[1] : null;
}

// cncf/people stores linkedin/twitter as full profile URLs too; pull the last
// non-empty path segment off as the bare handle the site's link builders expect.
function lastSegment(url) {
  if (!url) return null;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const segment = path.split('/').filter(Boolean).pop();
    return segment || null;
  } catch {
    return null;
  }
}

// cncf/people bios are HTML fragments (paragraphs, line breaks, links). Turn
// block-level boundaries into whitespace before stripping tags so sentences
// from separate <p>/<br> elements don't collapse into one run-on string.
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<\/(p|div|li)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let peopleIndex = null;
try {
  const response = await fetch(PEOPLE_JSON_URL);
  if (!response.ok) throw new Error(`cncf/people returned ${response.status}`);
  const records = await response.json();
  peopleIndex = new Map();
  for (const record of records) {
    const handle = handleFromUrl(record.github);
    if (handle) peopleIndex.set(handle.toLowerCase(), record);
  }
} catch (error) {
  // Without the upstream dataset we cannot safely refresh anyone's profile.
  // Fail closed rather than writing degraded data over a good cache.
  console.error(`Could not load cncf/people/people.json: ${error.message}`);
  process.exit(1);
}

const result = {};
let fallbacks = 0;

for (const [section, entries] of Object.entries(people)) {
  result[section] = [];
  for (const { name, company, role, github, linkedin, twitter } of entries) {
    if (github && !GITHUB_HANDLE.test(github)) {
      console.error(
        `data/community-roster.json: ${name} has an invalid GitHub handle: ${JSON.stringify(github)}`,
      );
      process.exit(1);
    }

    const previous =
      existingPeople[section]?.find(
        (person) => person.github === github && github,
      ) ?? {};
    const profile = (github && peopleIndex.get(github.toLowerCase())) || null;
    if (github && !profile) fallbacks += 1;

    result[section].push({
      // Roster fields (name, company, role) are curated and authoritative;
      // cncf/people only fills in what the roster does not already provide.
      name: name || previous.name || '',
      company: company || profile?.company || previous.company || '',
      role: role || previous.role || null,
      bio: stripHtml(profile?.bio) || previous.bio || '',
      location: profile?.location || previous.location || '',
      image: resolveImage({ name, github, profile, previous, fallbackImages }),
      github,
      linkedin:
        linkedin || lastSegment(profile?.linkedin) || previous.linkedin || null,
      twitter:
        twitter || lastSegment(profile?.twitter) || previous.twitter || null,
      blog: profile?.website || previous.blog || '',
    });
  }
}

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    { fetchedAt: new Date().toISOString(), people: result },
    null,
    2,
  ) + '\n',
);
console.log(
  `Refreshed ${Object.values(result).flat().length} community profiles${fallbacks ? ` (${fallbacks} fallback${fallbacks === 1 ? '' : 's'})` : ''}`,
);

function imageUrl(profile) {
  if (!profile?.image) return '';
  // cncf/people entries store either a repo-relative filename or, for some
  // legacy records, a full URL already -- pass an existing URL through. Any
  // scheme counts as "already a URL" so that a non-http value is handed to the
  // host gate below instead of being concatenated onto the mirror base.
  if (/^[a-z][a-z0-9+.-]*:/i.test(profile.image)) return profile.image;
  return PEOPLE_IMAGE_BASE + encodeURIComponent(profile.image);
}

// Picks the first image candidate that survives the host gate, in preference
// order, so a rejected upstream URL degrades to the cached, curated or derived
// avatar instead of being published. Every candidate is checked, not just the
// upstream one: a value cached from a run that predates this gate, or hand-added
// to the roster, reaches the same <img src> on the community page.
function resolveImage({ name, github, profile, previous, fallbackImages }) {
  const upstream = imageUrl(profile);
  if (upstream && !profileImageUrl(upstream)) {
    console.warn(
      `cncf/people image for ${name} is not an https URL on an allowed host, ignoring: ${JSON.stringify(upstream)}`,
    );
  }
  return firstAllowedImageUrl(
    upstream,
    previous.image,
    fallbackImages[name],
    github ? `https://github.com/${github}.png` : '',
  );
}
