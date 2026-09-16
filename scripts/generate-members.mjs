#!/usr/bin/env node
// Derives data/members.json from the CNCF landscape, architecture catalog, and awards.
// Run via: npm run generate:members
//
// Member identity uses the award slug as the canonical ID when available.
// For catalog-only organisations the slug is derived from the organisation name
// by stripping legal suffixes and collapsing punctuation.  Override edge-cases
// via SLUG_OVERRIDES below.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

// Manual slug overrides for organisation names whose automatic normalisation
// would produce the wrong result (e.g. "Flipkart Internet Pvt. Ltd." would
// become "flipkart-internet" without the override).
const SLUG_OVERRIDES = {
  'Flipkart Internet Pvt. Ltd.': 'flipkart',
  'Swisscom (Switzerland) Ltd': 'swisscom',
};

// Short brand-name overrides for organisations whose legal name is verbose.
// Used as the display name in the member card.
const DISPLAY_NAME_OVERRIDES = {
  'Allianz Direct': 'Allianz',
  'Flipkart Internet Pvt. Ltd.': 'Flipkart',
  'Swisscom (Switzerland) Ltd': 'Swisscom',
  'Mercedes-Benz Tech Innovation': 'Mercedes-Benz',
};

/** Converts an organisation display name to a URL-safe slug. */
function orgToSlug(name) {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name];
  return (
    name
      .toLowerCase()
      // Drop parenthetical qualifiers like "(Switzerland)"
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      // Drop common legal suffixes
      .replace(
        /\b(ltd\.?|inc\.?|corp\.?|ag|gmbh|pvt\.?|s\.a\.|b\.v\.|direct|group)\b/gi,
        '',
      )
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

const catalog = JSON.parse(
  readFileSync(join(root, 'data/architectures/catalog.json'), 'utf8'),
);
const awardsData = JSON.parse(
  readFileSync(join(root, 'data/awards.json'), 'utf8'),
);
const landscapeData = JSON.parse(
  readFileSync(join(root, 'data/landscape-end-users.json'), 'utf8'),
);
// The landscape uses the CNCF homepage for anonymised organisations.
const GENERIC_LANDSCAPE_HOMEPAGE = 'https://www.cncf.io/';

// Index awards by slug so each organisation accumulates all of its awards.
const awardsBySlug = {};
for (const award of awardsData.awards) {
  if (!award.slug) continue;
  (awardsBySlug[award.slug] ||= []).push(award);
}

// Index catalog entries by derived organisation slug.
const catalogBySlug = {};
for (const entry of catalog) {
  const slug = orgToSlug(entry.organization);
  (catalogBySlug[slug] ||= []).push(entry);
}

const landscapeBySlug = {};
for (const entry of landscapeData.entries) {
  const slug = orgToSlug(entry.name);
  landscapeBySlug[slug] = entry;
}

// Collect all unique member slugs from all authoritative sources.
const allSlugs = new Set([
  ...Object.keys(awardsBySlug),
  ...Object.keys(catalogBySlug),
  ...Object.keys(landscapeBySlug),
]);

/** Picks the best logo path for a member.
 * Preference order:
 *   1. Asset with "logo" in its filename
 *   2. Asset whose filename (without extension) exactly matches the member slug
 *      (e.g. "swisscom.png" for the "swisscom" member)
 *   3. Any SVG that is clearly a logo (short filename, no architecture jargon)
 *   4. Any PNG
 *   5. Award logo path
 *
 * @param {string[]} allAssets - all asset paths from all catalog entries
 * @param {Object[]} awardEntries
 * @param {string} slug - canonical member slug
 */
function pickLogo(allAssets, awardEntries, slug) {
  const basename = (p) =>
    p
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '');
  // 1. Any asset explicitly named "logo.*"
  const namedLogo = allAssets.find((a) => basename(a) === 'logo');
  if (namedLogo) return namedLogo;
  // 2. Asset whose filename matches the member slug exactly
  const exactMatch = allAssets.find((a) => basename(a) === slug);
  if (exactMatch) return exactMatch;
  // 3. Short SVG (logo images tend to have shorter filenames than diagrams)
  const svgs = allAssets.filter((a) => a.toLowerCase().endsWith('.svg'));
  if (svgs.length > 0) {
    svgs.sort((a, b) => basename(a).length - basename(b).length);
    return svgs[0];
  }
  // 4. Any PNG
  const png = allAssets.find((a) => a.toLowerCase().endsWith('.png'));
  if (png) return png;
  // 5. Award logo
  return awardEntries[0]?.logo || null;
}

const members = [];
for (const slug of [...allSlugs].sort()) {
  const catalogEntries = catalogBySlug[slug] || [];
  const awardEntries = awardsBySlug[slug] || [];
  const landscapeEntry = landscapeBySlug[slug];

  // Derive display name: prefer award organisation (usually the canonical short
  // brand name), apply DISPLAY_NAME_OVERRIDES, fall back to catalog org name.
  const rawName =
    awardEntries[0]?.organization ||
    landscapeEntry?.name ||
    catalogEntries[0]?.organization ||
    slug;
  const name = DISPLAY_NAME_OVERRIDES[rawName] || rawName;

  // Aggregate industries and projects from all architecture submissions.
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
    landscapeEntry?.homepage === GENERIC_LANDSCAPE_HOMEPAGE
      ? null
      : landscapeEntry?.homepage,
    landscapeEntry && landscapeData.sourceUrl,
    ...catalogEntries.map((e) => e.sourceUrl),
    ...awardEntries.map((a) => a.announcementUrl).filter(Boolean),
    ...awardEntries.map((a) => a.caseStudyUrl).filter(Boolean),
  ];

  members.push({
    id: slug,
    name,
    slug,
    logo: pickLogo(
      catalogEntries.flatMap((e) => e.assets || []),
      awardEntries,
      slug,
    ),
    role: landscapeEntry?.role || 'member',
    homepage: landscapeEntry?.homepage || null,
    industries,
    projects,
    architectures,
    awards,
    sourceAttribution: [...new Set(sourceAttribution.filter(Boolean))],
  });
}

const output = {
  description:
    'CNCF End User Community members and contributors identified in the CNCF landscape, enriched with reference architectures and Top End User Awards.',
  generatedFrom: [
    'data/landscape-end-users.json',
    'data/architectures/catalog.json',
    'data/awards.json',
  ],
  schema: {
    id: 'kebab-case identifier',
    name: 'display name',
    slug: 'URL-safe identifier',
    logo: 'optional static asset path',
    role: 'member or contributor from CNCF landscape',
    homepage: 'organisation homepage from CNCF landscape',
    industries: 'array of industry labels from architecture data',
    projects: 'array of CNCF project names from architecture data',
    architectures: 'reference architecture entries',
    awards: 'Top End User Award entries',
    sourceAttribution: 'authoritative source URLs',
  },
  members,
};

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(
  join(root, 'data/members.json'),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(`Generated ${members.length} member entries.`);
