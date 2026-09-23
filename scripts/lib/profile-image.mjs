// Host gate for community profile images.
//
// data/community-people.json is regenerated unattended from
// https://raw.githubusercontent.com/cncf/people/main/people.json, a repository
// this project does not control, and every image it names is rendered as an
// <img src> on the community page for every visitor. An unrestricted host is
// therefore a third-party beacon: it receives each visitor's IP, User-Agent
// and Referer on page load. The link fields on the same record are already
// resolved through a parser rather than a substring test (see
// src/lib/profile-links.mjs and scripts/lib/project-card-links.mjs); images
// are held to the same standard here.

const ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
  'github.com',
  'www.github.com',
]);

// Hosts allowed together with their subdomains.
const ALLOWED_DOMAIN_SUFFIXES = ['cncf.io'];

export function isAllowedImageHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  return ALLOWED_DOMAIN_SUFFIXES.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Resolves a profile image reference into a publishable absolute URL.
 *
 * Returns null for anything that is not an https URL on an allowlisted host.
 * A userinfo component is rejected outright: "https://www.cncf.io@evil.example/a.png"
 * parses to the host evil.example while reading as CNCF to a human skimming a
 * generated JSON diff.
 *
 * @param {string} [value]
 * @returns {string|null}
 */
export function profileImageUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!isAllowedImageHost(url.hostname)) return null;

  return url.href;
}

/**
 * Returns the first candidate that passes profileImageUrl, or '' when none do.
 *
 * Callers pass candidates in preference order (upstream, cached, curated
 * fallback, derived avatar) so a rejected value degrades to the next source
 * instead of being published.
 *
 * @param {...(string|null|undefined)} candidates
 * @returns {string}
 */
export function firstAllowedImageUrl(...candidates) {
  for (const candidate of candidates) {
    const resolved = profileImageUrl(candidate);
    if (resolved) return resolved;
  }
  return '';
}
