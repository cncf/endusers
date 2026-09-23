// Link builders for community member profiles.
//
// The values these functions receive are not repository data: the handles come
// from data/community-roster.json and the website comes from the free-text
// "blog" field of a third-party GitHub profile, copied verbatim into
// data/community-people.json by scripts/fetch-community-people.mjs and
// committed unedited by the scheduled refresh workflow. Everything here is
// therefore treated as untrusted input and resolved through the URL parser
// rather than through string tests.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const PROFILE_BASES = {
  github: 'https://github.com/',
  linkedin: 'https://www.linkedin.com/in/',
  twitter: 'https://twitter.com/',
};

/**
 * Builds the profile URL for a social handle.
 *
 * @param {string} [value] - the handle, percent-encoded before interpolation
 * @param {'github'|'linkedin'|'twitter'} type
 * @returns {string|null} an absolute URL, or null when there is no handle
 */
export function profileUrl(value, type) {
  if (!value) return null;
  const base = PROFILE_BASES[type] ?? PROFILE_BASES.twitter;
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
  if (!trimmed) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // A userinfo component is only ever used here to disguise the real host.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;

  return url.href;
}
