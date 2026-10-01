#!/usr/bin/env node
// Derives data/members.json from architecture, award, and (when present)
// pinned landscape data.
// Run via: npm run generate:members

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneOwnedLandscapeAssets } from './lib/enduser-assets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const SLUG_OVERRIDES = Object.assign(Object.create(null), {
  'Flipkart Internet Pvt. Ltd.': 'flipkart',
  'Swisscom (Switzerland) Ltd': 'swisscom',
});

const DISPLAY_NAME_OVERRIDES = Object.assign(Object.create(null), {
  'Allianz Direct': 'Allianz',
  'Flipkart Internet Pvt. Ltd.': 'Flipkart',
  'Swisscom (Switzerland) Ltd': 'Swisscom',
  'Mercedes-Benz Tech Innovation': 'Mercedes-Benz',
});

// This is the only cross-source alias currently justified by authoritative CNCF
// evidence: the 2019 Ant Financial Gold Member announcement and the 2025 Ant
// Group award announcement identify the same organization. Do not generalize
// this map into fuzzy matching.
const LANDSCAPE_ALIASES = Object.assign(Object.create(null), {
  'cncf/landscape#CNCF Members/Gold/Ant Financial (member)': 'ant-group',
});

/** Converts an organisation display name to a URL-safe slug. */
function orgToSlug(name) {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name];
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(
      /\b(ltd\.?|inc\.?|corp\.?|ag|gmbh|pvt\.?|s\.a\.|b\.v\.|direct|group)\b/gi,
      '',
    )
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function safeHttps(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function addUnique(values, value) {
  if (value && !values.includes(value)) values.push(value);
}

/** Picks the best logo path for a member. */
function pickLogo(allAssets, awardEntries, slug) {
  const basename = (p) =>
    p
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '');
  const namedLogo = allAssets.find((a) => basename(a) === 'logo');
  if (namedLogo) return namedLogo;
  const exactMatch = allAssets.find((a) => basename(a) === slug);
  if (exactMatch) return exactMatch;
  const svgs = allAssets.filter((a) => a.toLowerCase().endsWith('.svg'));
  if (svgs.length > 0) {
    svgs.sort((a, b) => basename(a).length - basename(b).length);
    return svgs[0];
  }
  const png = allAssets.find((a) => a.toLowerCase().endsWith('.png'));
  if (png) return png;
  return awardEntries[0]?.logo || null;
}

function legacyMembers(catalog, awardsData) {
  const awardsBySlug = Object.create(null);
  for (const award of awardsData.awards) {
    if (!award.slug) continue;
    (awardsBySlug[award.slug] ||= []).push(award);
  }

  const catalogBySlug = Object.create(null);
  for (const entry of catalog) {
    const slug = orgToSlug(entry.organization);
    (catalogBySlug[slug] ||= []).push(entry);
  }

  const allSlugs = new Set([
    ...Object.keys(awardsBySlug),
    ...Object.keys(catalogBySlug),
  ]);

  return [...allSlugs].sort().map((slug) => {
    const catalogEntries = catalogBySlug[slug] || [];
    const awardEntries = awardsBySlug[slug] || [];
    const rawName =
      awardEntries[0]?.organization || catalogEntries[0]?.organization || slug;
    const name = DISPLAY_NAME_OVERRIDES[rawName] || rawName;
    const industries = [
      ...new Set(catalogEntries.flatMap((e) => e.industries || [])),
    ].sort();
    const projects = [
      ...new Set(catalogEntries.flatMap((e) => e.projects || [])),
    ].sort();
    const architectures = catalogEntries.map((e) => ({
      id: e.id,
      title: e.title,
      sourceUrl: e.sourceUrl,
      sourceCommit: e.sourceCommit,
    }));
    const awards = awardEntries.map((a) => ({
      year: a.year,
      award: a.award,
      awardLabel: a.awardLabel,
      citation: a.citation,
      event: a.event,
      announcementUrl: a.announcementUrl || null,
      caseStudyUrl: a.caseStudyUrl || null,
      talkUrl: a.talkUrl || null,
    }));
    const sourceAttribution = [
      ...catalogEntries.map((e) => e.sourceUrl),
      ...awardEntries.map((a) => a.announcementUrl).filter(Boolean),
      ...awardEntries.map((a) => a.caseStudyUrl).filter(Boolean),
    ];

    return {
      id: slug,
      name,
      slug,
      logo: pickLogo(
        catalogEntries.flatMap((e) => e.assets || []),
        awardEntries,
        slug,
      ),
      industries,
      projects,
      architectures,
      awards,
      sourceAttribution,
    };
  });
}

function assertLandscapeSnapshot(snapshot) {
  if (snapshot?.generated !== true) {
    throw new Error('enduser-landscape.json must be generated');
  }
  if (!snapshot?.source?.revision || !snapshot?.source?.sourceUrl) {
    throw new Error(
      'enduser-landscape.json must carry a pinned source revision and URL',
    );
  }
  if (!Array.isArray(snapshot.records) || snapshot.records.length === 0) {
    throw new Error('enduser-landscape.json must contain records');
  }
  if (!snapshot.records.some((record) => record.included)) {
    throw new Error(
      'enduser-landscape.json must contain at least one included record',
    );
  }
}

function sourceEntry(record, sourceUrl) {
  return {
    sourceId: record.sourceId,
    role: record.sourceRole,
    sourceName: record.sourceName,
    category: record.category,
    subcategory: record.subcategory,
    homepageUrl: record.homepageUrl || null,
    joined: record.joined || null,
    localLogo: record.localLogo || null,
    sourceUrl,
  };
}

function membershipStatus(member) {
  const roles = new Set(member.membershipSources.map((source) => source.role));
  if (roles.has('member') && roles.has('contributor')) {
    return 'member-and-contributor';
  }
  if (roles.has('member')) return 'member';
  if (roles.has('contributor')) return 'contributor';
  return 'unknown';
}

function mergeLandscapeMembers(members, snapshot) {
  assertLandscapeSnapshot(snapshot);
  const byId = new Map(members.map((member) => [member.id, member]));
  const byName = new Map();
  for (const member of members) {
    const matches = byName.get(member.name) || [];
    matches.push(member);
    byName.set(member.name, matches);
  }
  const sourceUrl = snapshot.source.sourceUrl;
  const seenSources = new Set();

  for (const record of snapshot.records) {
    if (!record.included) continue;
    if (seenSources.has(record.sourceId)) {
      throw new Error(`duplicate landscape source record: ${record.sourceId}`);
    }
    seenSources.add(record.sourceId);

    const aliasId = LANDSCAPE_ALIASES[record.sourceId];
    const exactMatches = byName.get(record.displayName) || [];
    if (!aliasId && exactMatches.length > 1) {
      throw new Error(
        `ambiguous landscape identity for ${record.sourceId}: ${record.displayName}`,
      );
    }
    let member = aliasId ? byId.get(aliasId) : exactMatches[0];
    if (aliasId && !member) {
      throw new Error(
        `landscape alias target missing: ${record.sourceId} -> ${aliasId}`,
      );
    }

    if (!member) {
      const id = orgToSlug(record.displayName);
      if (!id) {
        throw new Error(
          `landscape record has no usable output ID: ${record.sourceId}`,
        );
      }
      if (byId.has(id)) {
        throw new Error(
          `landscape identity collision for ${record.sourceId}: ${id}`,
        );
      }
      member = {
        id,
        name: record.displayName,
        slug: id,
        logo: record.localLogo || null,
        industries: [],
        projects: [],
        architectures: [],
        awards: [],
        sourceAttribution: [],
      };
      members.push(member);
      byId.set(id, member);
      byName.set(member.name, [member]);
    }

    member.membershipSources ||= [];
    member.membershipSources.push(sourceEntry(record, sourceUrl));
    addUnique(member.sourceAttribution, sourceUrl);
    if (safeHttps(record.homepageUrl)) {
      addUnique(member.sourceAttribution, record.homepageUrl);
    }
    if (!member.logo && record.localLogo) {
      member.logo = record.localLogo;
    }
  }

  for (const member of members) {
    member.membershipSources ||= [];
    member.membershipStatus = membershipStatus(member);
  }

  return members;
}

const catalog = readJson('data/architectures/catalog.json');
const awardsData = readJson('data/awards.json');
const snapshotPath = join(root, 'data/enduser-landscape.json');
const snapshot = existsSync(snapshotPath)
  ? JSON.parse(readFileSync(snapshotPath, 'utf8'))
  : null;
const members = legacyMembers(catalog, awardsData);

if (snapshot) mergeLandscapeMembers(members, snapshot);

const output = {
  description: snapshot
    ? 'CNCF End User Community organizations from pinned landscape Member and Contributor records, reference architectures, and Top End User Award winners.'
    : 'CNCF End User Community member organisations derived from reference architectures and Top End User Award winners.',
  generatedFrom: [
    ...(snapshot ? ['data/enduser-landscape.json'] : []),
    'data/architectures/catalog.json',
    'data/awards.json',
  ],
  ...(snapshot
    ? {
        generatedAt: snapshot.collectedAt,
        sources: {
          landscape: {
            ...snapshot.source,
            collectedAt: snapshot.collectedAt,
          },
        },
      }
    : {}),
  schema: {
    id: 'kebab-case identifier',
    name: 'display name',
    slug: 'URL-safe identifier',
    ...(snapshot
      ? {
          membershipStatus:
            'member, contributor, member-and-contributor, or unknown',
          membershipSources:
            'explicit pinned landscape source records; empty for unknown membership',
        }
      : {}),
    logo: 'optional static asset path',
    industries: 'array of industry labels from architecture data',
    projects: 'array of CNCF project names from architecture data',
    architectures: 'reference architecture entries',
    awards: 'Top End User Award entries',
    sourceAttribution: 'authoritative source URLs',
  },
  members: snapshot
    ? [...members].sort((a, b) => a.name.localeCompare(b.name))
    : members,
};

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  join(root, 'data/members.json'),
  JSON.stringify(output, null, 2) + '\n',
);
if (snapshot) {
  pruneOwnedLandscapeAssets({
    assetRoot: join(root, 'static/img/end-user-members'),
    manifestPath: join(root, 'data/enduser-landscape-assets.json'),
    snapshot,
    members: output.members,
  });
}
console.log(`Generated ${members.length} member entries.`);
