// Link builders for community member profiles.
//
// The values these functions receive are not repository data: the handles come
// from data/community-roster.json and the website comes from the free-text
// "blog" field of a third-party GitHub profile, copied verbatim into
// data/community-people.json by scripts/fetch-community-people.mjs and
// committed unedited by the scheduled refresh workflow. Everything here is
// therefore treated as untrusted input and resolved through the URL parser
// rather than through string tests.
//
// websiteUrl() below resolves through isSafeUrl() from
// scripts/lib/url-safety.mjs (see endusers#1388): that module is the fs-free
// core of scripts/lib/validate-utils.mjs, kept free of `node:*` imports
// precisely so this module can share it — this file is bundled into the
// browser by src/components/CommunityPeople, and a Node-only import anywhere
// in its graph breaks the client build.

import { isSafeUrl } from '../../scripts/lib/url-safety.mjs';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

// Null prototype: a lookup keyed by untrusted `type` must miss for anything
// that is not one of the three known networks, including inherited
// Object.prototype members such as `constructor` (see #504).
const PROFILE_BASES = Object.assign(Object.create(null), {
  github: 'https://github.com/',
  linkedin: 'https://www.linkedin.com/in/',
  twitter: 'https://twitter.com/',
});

/**
 * Builds the profile URL for a social handle.
 *
 * @param {string} [value] - the handle, percent-encoded before interpolation
 * @param {'github'|'linkedin'|'twitter'} type
 * @returns {string|null} an absolute URL, or null when there is no handle or
 *   the network is not one of the three known bases — a silent fallback would
 *   link the handle to the wrong site.
 */
export function profileUrl(value, type) {
  if (!value) return null;
  const base = PROFILE_BASES[type];
  if (!base) return null;
  return `${base}${encodeURIComponent(value)}`;
}

/**
 * Resolves a person's website into a safe absolute URL.
 *
 * A value without a scheme is treated as a host and resolved against https,
 * never concatenated: concatenation lets a value such as
 * "trusted.example@attacker.example" produce a link whose visible prefix and
 * real authority disagree. Anything that does not parse, or that parses to a
 * protocol outside http/https, is dropped.
 *
 * @param {string} [value]
 * @returns {string|null}
 */
export function websiteUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Stryker disable next-line ConditionalExpression: an empty trimmed value fails every later pattern and returns null
  if (!trimmed) return null;

  const url = isSafeUrl(trimmed, {
    protocols: ALLOWED_PROTOCOLS,
    defaultScheme: 'https:',
  });
  return url ? url.href : null;
}
